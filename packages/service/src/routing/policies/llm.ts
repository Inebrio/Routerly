import type { ModelConfig } from '@localrouter/shared';
import { readConfig } from '../../config/loader.js';
import { getProviderAdapter } from '../../providers/index.js';
import type { PolicyFn } from './types.js';

function buildSystemPrompt(candidates: { id: string; prompt?: string }[]): string {
  const modelList = candidates
    .map(c => `- ${c.id}${c.prompt ? `: ${c.prompt}` : ''}`)
    .join('\n');

  return [
    'You are a routing assistant. Your task is to analyze the user\'s request and assign a relevance score to each available AI model.',
    '',
    'Available models:',
    modelList,
    '',
    'Respond ONLY with a valid JSON object — no markdown, no explanation — in this exact format:',
    '{',
    '  "routing": [',
    '    { "model": "<model_id>", "point": <0.0-1.0> },',
    '    ...',
    '  ]',
    '}',
    '',
    'Include ALL models. Assign point 1.0 to the best match and 0.0 to the worst.',
  ].join('\n');
}

function buildUserMessage(request: { messages: { role: string; content: unknown }[] }): string {
  const lastUserMsg = [...request.messages]
    .reverse()
    .find(m => m.role === 'user');

  const content = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : JSON.stringify(lastUserMsg?.content ?? '');

  return `User request:\n${content}`;
}

function parseRoutingResponse(text: string): { model: string; point: number }[] | null {
  // strip markdown code fences if present
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.routing)) {
      return parsed.routing;
    }
  } catch {
    // ignore
  }
  return null;
}

async function repairRoutingResponse(
  adapter: ReturnType<typeof getProviderAdapter>,
  model: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  invalidResponse: string,
  log?: { info: (obj: object, msg?: string) => void },
): Promise<{ model: string; point: number }[] | null> {
  const repairUserMessage = [
    'Your previous response was not valid JSON or did not match the expected structure.',
    '',
    'Previous response:',
    invalidResponse,
    '',
    'Return ONLY the corrected JSON object with no markdown, no explanation:',
    '{',
    '  "routing": [',
    '    { "model": "<model_id>", "point": <0.0-1.0> },',
    '    ...',
    '  ]',
    '}',
  ].join('\n');

  try {
    const repairResponse = await adapter.chatCompletion(
      {
        model: model.id,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
          { role: 'assistant', content: invalidResponse },
          { role: 'user', content: repairUserMessage },
        ],
        temperature: 0,
        max_tokens: 512,
        stream: false,
      },
      model,
    );

    const repairText = repairResponse.choices?.[0]?.message?.content ?? '';
    log?.info({ raw: repairText }, 'llm policy: repair response');
    return parseRoutingResponse(repairText);
  } catch (err) {
    log?.info({ err: String(err) }, 'llm policy: repair call failed');
    return null;
  }
}

export const llmPolicy: PolicyFn = async ({ request, candidates, config, log }) => {
  log?.info(
    {
      request: {
        model: request.model,
        messages: request.messages,
        stream: request.stream,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
      },
      candidates: candidates.map(c => ({ id: c.model.id, provider: c.model.provider })),
      config,
    },
    'llm policy: input',
  );

  const routingModelId: string | undefined = config?.routingModelId;
  if (!routingModelId) {
    throw new Error('llm policy: routingModelId not configured');
  }

  const allModels: ModelConfig[] = await readConfig('models');

  const fallbackModelIds: string[] = config?.fallbackModelIds ?? [];
  const candidateModelIds = [routingModelId, ...fallbackModelIds];

  const systemPrompt = buildSystemPrompt(
    candidates.map(c => ({ id: c.model.id, prompt: c.prompt })),
  );
  const userMessage = buildUserMessage(request);

  log?.info({ systemPrompt, userMessage }, 'llm policy: prompts');

  for (const modelId of candidateModelIds) {
    const model = allModels.find(m => m.id === modelId);
    if (!model) {
      log?.info({ modelId, reason: 'model not found' }, 'llm policy: skipping model');
      continue;
    }

    try {
      const adapter = getProviderAdapter(model);
      const response = await adapter.chatCompletion(
        {
          model: model.id,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0,
          max_tokens: 512,
          stream: false,
        },
        model,
      );

      const text = response.choices?.[0]?.message?.content ?? '';
      log?.info({ modelId, raw: text }, 'llm policy: raw response');

      let routing = parseRoutingResponse(text);
      if (!routing) {
        log?.info({ modelId, reason: 'parse failed, attempting repair' }, 'llm policy: repair');
        routing = await repairRoutingResponse(adapter, model, systemPrompt, userMessage, text, log);
      }

      if (!routing) {
        log?.info({ modelId, reason: 'repair failed' }, 'llm policy: skipping model');
        continue;
      }

      log?.info({ modelId, routing }, 'llm policy: output');
      return { routing };
    } catch (err) {
      log?.info({ modelId, err: String(err), reason: 'call failed' }, 'llm policy: skipping model');
    }
  }

  throw new Error(`llm policy: all models failed [${candidateModelIds.join(', ')}]`);
};
