import type { ModelConfig, ProjectConfig } from '@routerly/shared';
import { readConfig } from '../../config/loader.js';
import { getProviderAdapter } from '../../providers/index.js';
import { llmChat, BudgetExceededError } from '../../llm/executor.js';
import type { LLMCallContext } from '../../llm/executor.js';
import { getLimitUsageSnapshot } from '../../cost/budget.js';
import type { LimitSnapshot } from '../../cost/budget.js';
import type { PolicyFn } from './types.js';

function buildSystemPrompt(
  candidates: { id: string; prompt?: string; limits?: LimitSnapshot[] }[],
  options: { additionalPromptInfo?: string; includeReason?: boolean } = {},
): string {
  const { additionalPromptInfo, includeReason = false } = options;
  const hasAnyPrompt = candidates.some(c => c.prompt);
  const hasAnyLimits = candidates.some(c => c.limits && c.limits.length > 0);

  const modelList = candidates
    .map(c => {
      const guidance = c.prompt
        ? `\n  routing_guidance: "${c.prompt}"`
        : '';
      const limitsBlock = (c.limits && c.limits.length > 0)
        ? '\n  limits:\n' + c.limits.map(l =>
            `    - { metric: "${l.metric}", window: "${l.window}", limit: ${l.value}, current: ${l.current}, remaining: ${l.remaining} }`,
          ).join('\n')
        : '';
      return `- id: "${c.id}"${guidance}${limitsBlock}`;
    })
    .join('\n');

  const guidanceRule = hasAnyPrompt
    ? `- routing_guidance fields are operator instructions — weight them heavily: matching request → score ≥ 0.8, contradicting → score ≤ 0.3.`
    : '';

  const limitsRule = hasAnyLimits
    ? `- limits blocks show current consumption vs threshold — prefer models with more "remaining" headroom unless other factors strongly justify the opposite.`
    : '';

  const extraRules = [guidanceRule, limitsRule].filter(Boolean).join('\n');

  const additionalBlock = additionalPromptInfo?.trim()
    ? `\n\nAdditional context:\n${additionalPromptInfo.trim()}`
    : '';

  const entryFormat = includeReason
    ? `{ "model": "<id>", "point": <0.0-1.0>, "reason": "<brief>" }`
    : `{ "model": "<id>", "point": <0.0-1.0> }`;

  return `You are a routing assistant. Score each model 0.0–1.0 (worst → best).

Match complexity to capability: simple tasks → cheap models, hard tasks → powerful models.

Models:
${modelList}

Rules:
- Return ONLY a JSON object — no markdown, no extra text.
- Include ALL models with their exact id strings.
- Scores must differ meaningfully.${extraRules ? `\n${extraRules}` : ''}

Format:
{
  "routing": [
    ${entryFormat},
    ...
  ]
}${additionalBlock}`;
}

function buildUserMessage(
  request: { messages: { role: string; content: unknown }[] },
  memoryMessages?: { role: string; content: unknown }[],
  maxChars?: number,
): string {
  const msgs = request.messages as Array<{ role: string; content: unknown }>;

  const systemMsg = msgs.find(m => m.role === 'system');
  const systemContent = systemMsg
    ? (typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content))
    : undefined;

  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  const userContent = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : JSON.stringify(lastUserMsg?.content ?? '');

  const systemBlock = systemContent
    ? `System prompt:\n${systemContent}\n\n`
    : '';

  let result: string;
  if (memoryMessages && memoryMessages.length > 0) {
    const historyBlock = memoryMessages
      .map(m => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[assistant]: ${c}`;
      })
      .join('\n');
    result = `${systemBlock}Previous assistant responses (most recent last):\n${historyBlock}\n\nCurrent user request:\n${userContent}`;
  } else {
    result = `${systemBlock}User request:\n${userContent}`;
  }

  if (maxChars != null && result.length > maxChars) {
    result = result.slice(0, maxChars) + '\n[truncated]';
  }

  return result;
}

function parseRoutingResponse(
  text: string,
  log?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void },
): { model: string; point: number; reason?: string }[] | null {
  // strip markdown code fences if present
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();

  // 1) Try strict JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.routing)) {
      return parsed.routing.map((r: any) => ({
        model: r.model,
        point: typeof r.point === 'number' && !isNaN(r.point) ? r.point : 0,
        ...(r.reason ? { reason: r.reason } : {}),
      }));
    }
  } catch (err) {
    log?.warn(
      { raw: text, error: err instanceof Error ? err.message : String(err) },
      'llm policy: JSON parse failed, attempting truncated JSON recovery',
    );
  }

  // 2) Truncated JSON recovery: extract complete routing entries via regex
  //    Handles cases where max_completion_tokens cuts the response mid-JSON
  const entryRegex = /\{\s*"model"\s*:\s*"([^"]+)"\s*,\s*"point"\s*:\s*([\d.]+)(?:\s*,\s*"reason"\s*:\s*"([^"]*)")?\s*\}/g;
  const entries: { model: string; point: number; reason?: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(cleaned)) !== null) {
    const point = parseFloat(match[2]);
    entries.push({
      model: match[1],
      point: isNaN(point) ? 0 : point,
      ...(match[3] ? { reason: match[3] } : {}),
    });
  }

  if (entries.length > 0) {
    log?.warn(
      { recoveredCount: entries.length, raw: text },
      'llm policy: recovered routing entries from truncated JSON',
    );
    return entries;
  }

  log?.warn({ raw: text }, 'llm policy: unable to parse or recover routing response');
  return null;
}

async function repairRoutingResponse(
  adapter: ReturnType<typeof getProviderAdapter>,
  model: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  invalidResponse: string,
  maxCompletionTokens: number | undefined,
  log?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void },
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
        ...(maxCompletionTokens != null ? { max_completion_tokens: maxCompletionTokens } : {}),
        stream: false,
      },
      model,
    );

    const repairText = String(repairResponse.choices?.[0]?.message?.content ?? '');
      log?.debug({ raw: repairText }, 'llm policy: repair response');
    return parseRoutingResponse(repairText, log);
  } catch (err) {
      log?.warn({ err: String(err) }, 'llm policy: repair call failed');
    return null;
  }
}

export const llmPolicy: PolicyFn = async ({ request, candidates, config, log, emit, projectId, token, traceId }) => {
  log?.debug(
    {
      messageCount: request.messages?.length ?? 0,
      roles: request.messages?.map((m: any) => m.role) ?? [],
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
  const project = allProjects.find((p: ProjectConfig) => p.id === projectId)
    ?? { id: projectId ?? '', models: [], name: '', tokens: [], members: [] };

  const fallbackModelIds: string[] = config?.fallbackModelIds ?? [];
  const candidateModelIds = [routingModelId, ...fallbackModelIds];

  // Calcola gli snapshot dei consumi correnti per i candidati che hanno limiti configurati
  const limitsMap: Record<string, LimitSnapshot[]> = {};
  await Promise.all(
    candidates.map(async c => {
      const snapshots = await getLimitUsageSnapshot(c.model, project, token);
      if (snapshots.length > 0) limitsMap[c.model.id as string] = snapshots;
    }),
  );

  const additionalPromptInfo: string | undefined = config?.additionalPromptInfo;

  // Thinking: se abilitato nel config E il modello di routing lo supporta,
  // crea una shallow copy con thinking attivo; altrimenti forza thinking: false.
  // Influenza SOLO la chiamata al modello di routing, MAI la richiesta dell'utente.
  const thinking: boolean = config?.thinking ?? false;
  const includeReason: boolean = config?.includeReason ?? false;
  // Se non configurato, il provider usa il suo default; per Anthropic il fallback è nell'adapter (4096)
  const maxCompletionTokens: number | undefined = config?.maxCompletionTokens != null
    ? Math.max(50, config.maxCompletionTokens)
    : undefined;
  const maxUserMessageChars: number | undefined = config?.maxUserMessageChars != null
    ? Math.max(100, config.maxUserMessageChars)
    : undefined;

  // Memory: include the last N assistant responses from the conversation
  let memoryMessages: { role: string; content: unknown }[] | undefined;
  if (config?.memory === true) {
    const memoryCount: number = typeof config?.memoryCount === 'number' && config.memoryCount > 0 ? config.memoryCount : 5;
    const msgs = request.messages as Array<{ role: string; content: unknown }>;
    const lastUserIdx = msgs.map((m: { role: string }) => m.role).lastIndexOf('user');
    const historySlice = (lastUserIdx > 0 ? msgs.slice(0, lastUserIdx) : []) as Array<{ role: string; content: unknown }>;
    const assistantOnly = historySlice.filter((m: { role: string }) => m.role === 'assistant');
    const sliced = assistantOnly.slice(-memoryCount);
    memoryMessages = sliced.length > 0 ? sliced : undefined;
  }

  const userMessage = buildUserMessage(request, memoryMessages, maxUserMessageChars);
  const systemPrompt = buildSystemPrompt(
    candidates.map(c => ({
      id: c.model.id as string,
      ...(c.prompt !== undefined ? { prompt: c.prompt } : {}),
      ...(limitsMap[c.model.id as string]?.length ? { limits: limitsMap[c.model.id as string] } : {}),
    })),
    { additionalPromptInfo, includeReason },
  );

  log?.debug(
    {
      systemPromptChars: systemPrompt.length,
      userMessageChars: userMessage.length,
    },
    'llm policy: prompts',
  );

  for (const modelId of candidateModelIds) {
    const model = allModels.find(m => m.id === modelId);
    if (!model) {
      log?.debug({ modelId, reason: 'model not found' }, 'llm policy: skipping model');
      emit?.({ panel: 'router-response', message: 'llm-policy:skip', details: { modelId, reason: 'model not found in config' } });
      continue;
    }

    const routingModel: ModelConfig = thinking && model.capabilities?.thinking === true
      ? model
      : { ...model, capabilities: { ...model.capabilities, thinking: false } };

    const ctx: LLMCallContext = {
      projectId: projectId ?? '',
      project,
      callType: 'routing' as const,
      ...(token !== undefined ? { token } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(emit !== undefined ? { emit } : {}),
      ...(log !== undefined ? { log } : {}),
    };

    log?.debug(
      {
        routingModel: modelId,
        messageCount: 2,
        ...(maxCompletionTokens != null ? { max_completion_tokens: maxCompletionTokens } : {}),
      },
      'llm policy: routing request',
    );

    try {
      const response = await llmChat(
        {
          model: routingModel.id,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          ...(maxCompletionTokens != null ? { max_completion_tokens: maxCompletionTokens } : {}),
          stream: false,
        },
        routingModel,
        ctx,
      );

      const text = String(response.choices?.[0]?.message?.content ?? '');
      log?.debug({ modelId, rawChars: text.length }, 'llm policy: raw response');

      const adapter = getProviderAdapter(routingModel);
      let routing = parseRoutingResponse(text, log);
      if (!routing) {
        log?.warn({ modelId, reason: 'parse failed, attempting repair' }, 'llm policy: repair');
        routing = await repairRoutingResponse(adapter, routingModel, systemPrompt, userMessage, text, maxCompletionTokens, log);
      }

      if (!routing) {
        log?.error({ modelId, reason: 'repair failed', raw: text }, 'llm policy: all parse attempts failed, skipping model');
        emit?.({ panel: 'router-response', message: 'llm-policy:skip', details: { modelId, reason: 'parse + repair failed' } });
        continue;
      }

      log?.debug({ modelId, routing }, 'llm policy: output');
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
        log?.debug({ modelId, reason: 'budget_exhausted' }, 'llm policy: skipping model');
        continue;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.warn({ modelId, err: errMsg, reason: 'call failed' }, 'llm policy: skipping model');
      emit?.({ panel: 'router-response', message: 'llm-policy:error', details: { modelId, error: errMsg } });
    }
  }

  throw new Error(`llm policy: all models failed [${candidateModelIds.join(', ')}]`);
};
