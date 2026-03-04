import type { ModelConfig, ProjectConfig } from '@localrouter/shared';
import { readConfig } from '../../config/loader.js';
import { getProviderAdapter } from '../../providers/index.js';
import { llmChat, BudgetExceededError } from '../../llm/executor.js';
import type { LLMCallContext } from '../../llm/executor.js';
import type { PolicyFn } from './types.js';

function buildSystemPrompt(candidates: { id: string; prompt?: string }[]): string {
  const modelList = candidates
    .map(c => `- id: "${c.id}"${c.prompt ? `\n  description: "${c.prompt}"` : ''}`)
    .join('\n');

  const exampleRouting = candidates
    .map(c => `    { "model": "${c.id}", "point": 0.8, "reason": "suitable for this type of request" }`)
    .join(',\n');

  return `You are a routing assistant. Given a user request, score each available AI model by relevance (0.0 = worst, 1.0 = best).

Available models:
${modelList}

Your response MUST be a single JSON object, with no text before or after it, no markdown, no code fences. Example format:
{
  "routing": [
${exampleRouting}
  ]
}

Rules:
- Include ALL models listed above, using their exact id strings.
- "point" must be a number between 0.0 and 1.0.
- "reason" must be a single short sentence explaining the score.
- Do not output anything outside the JSON object.`;
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

function parseRoutingResponse(text: string): { model: string; point: number; reason?: string }[] | null {
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
  const repairUserMessage = `Your previous response was not valid JSON or did not match the expected structure.

Previous response:
${invalidResponse}

Return ONLY a valid JSON object with no text before or after it, no markdown, no code fences:
{
  "routing": [
    { "model": "<model_id>", "point": <0.0-1.0>, "reason": "<brief reason>" },
    ...
  ]
}`;

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
        max_completion_tokens: 2048,
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

export const llmPolicy: PolicyFn = async ({ request, candidates, config, log, emit, projectId, token }) => {
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
  const allProjects: ProjectConfig[] = await readConfig('projects');
  // Se il progetto non è trovato, usa un oggetto vuoto: checkBudget ricadrà
  // su isAllowedForRoutingModel (globalThresholds only).
  const project = allProjects.find((p: ProjectConfig) => p.id === projectId)
    ?? { id: projectId ?? '', models: [], name: '' } as ProjectConfig;

  const fallbackModelIds: string[] = config?.fallbackModelIds ?? [];
  const candidateModelIds = [routingModelId, ...fallbackModelIds];

  const systemPrompt = buildSystemPrompt(
    candidates.map(c => ({
      id: c.model.id as string,
      ...(c.prompt !== undefined ? { prompt: c.prompt } : {}),
    })),
  );
  const userMessage = buildUserMessage(request);

  log?.info({ systemPrompt, userMessage }, 'llm policy: prompts');

  for (const modelId of candidateModelIds) {
    const model = allModels.find(m => m.id === modelId);
    if (!model) {
      log?.info({ modelId, reason: 'model not found' }, 'llm policy: skipping model');
      emit?.({ panel: 'router-response', message: 'llm-policy:skip', details: { modelId, reason: 'model not found in config' } });
      continue;
    }

    const ctx: LLMCallContext = {
      projectId: projectId ?? '',
      project,
      callType: 'routing' as const,
      ...(token !== undefined ? { token } : {}),
      ...(emit !== undefined ? { emit } : {}),
      ...(log !== undefined ? { log } : {}),
    };

    try {
      const response = await llmChat(
        {
          model: model.id,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_completion_tokens: 2048,
          stream: false,
        },
        model,
        ctx,
      );

      const text = response.choices?.[0]?.message?.content ?? '';
      log?.info({ modelId, raw: text }, 'llm policy: raw response');

      const adapter = getProviderAdapter(model);
      let routing = parseRoutingResponse(text);
      if (!routing) {
        log?.info({ modelId, reason: 'parse failed, attempting repair' }, 'llm policy: repair');
        routing = await repairRoutingResponse(adapter, model, systemPrompt, userMessage, text, log);
      }

      if (!routing) {
        log?.info({ modelId, reason: 'repair failed' }, 'llm policy: skipping model');
        emit?.({ panel: 'router-response', message: 'llm-policy:skip', details: { modelId, reason: 'parse + repair failed' } });
        continue;
      }

      log?.info({ modelId, routing }, 'llm policy: output');
      emit?.({
        panel: 'router-response',
        message: 'llm-policy:scores',
        details: {
          routingModel: modelId,
          scores: routing.map(r => ({
            model: r.model,
            point: r.point,
            ...(r.reason ? { reason: r.reason } : {}),
          })),
        },
      });
      return { routing };
    } catch (err: unknown) {
      if (err instanceof BudgetExceededError) {
        // L'executor ha già emesso model:skipped e tracciato l'evento
        log?.info({ modelId, reason: 'budget_exhausted' }, 'llm policy: skipping model');
        continue;
      }
      // Errore del provider: l'executor ha già tracciato + emesso model:error
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.info({ modelId, err: errMsg, reason: 'call failed' }, 'llm policy: skipping model');
      emit?.({ panel: 'router-response', message: 'llm-policy:error', details: { modelId, error: errMsg } });
    }
  }

  throw new Error(`llm policy: all models failed [${candidateModelIds.join(', ')}]`);
};
