import type { ModelConfig, ProjectConfig } from '@routerly/shared';
import { readConfig } from '../../config/loader.js';
import { llmChat, BudgetExceededError } from '../../llm/executor.js';
import { getRoutingHistory } from '../routingMemoryStore.js';
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

  return `You are a routing engine, NOT a user assistant. Your ONLY job is to score models for routing. NEVER answer, solve, or respond to the user's request in any way.

Match complexity to capability: simple tasks → cheap models, hard tasks → powerful models.

Models:
${modelList}

Rules:
- Never output code, prose, or any explanation. Your only output is a single JSON object.
- Include ALL models with their exact id strings.
- Scores must differ meaningfully.${extraRules ? `\n${extraRules}` : ''}${additionalBlock}

Respond with ONLY this JSON object and nothing else:
{
  "routing": [
    ${entryFormat},
    ...
  ]
}`;
}

function buildUserMessage(
  request: { messages: { role: string; content: unknown }[] },
  previousDecisions?: { model: string }[],
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
    ? `<system_prompt>\n${systemContent}\n</system_prompt>\n\n`
    : '';

  let requestBlock: string;
  if (previousDecisions && previousDecisions.length > 0) {
    const historyBlock = previousDecisions
      .map((d, i) => `- Turn ${i + 1}: routed to ${d.model}`)
      .join('\n');
    requestBlock = `Previous routing decisions (most recent last):\n${historyBlock}\n\n<request_to_route>\n${userContent}\n</request_to_route>`;
  } else {
    requestBlock = `<request_to_route>\n${userContent}\n</request_to_route>`;
  }

  let result = `Analyze the task type of the request below and score each model. Do NOT solve or answer it.\n\n${systemBlock}${requestBlock}\n\nRespond ONLY with the JSON object described in your instructions.`;

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
    const point = parseFloat(match[2] ?? '');
    entries.push({
      model: match[1] ?? '',
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
  model: ModelConfig,
  systemPrompt: string,
  maxCompletionTokens: number | undefined,
  ctx: LLMCallContext,
  log?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void },
): Promise<{ model: string; point: number }[] | null> {
  // Minimal prompt: no user content, no conversation history.
  // Re-exposing the user's request (e.g. a coding challenge) would risk
  // the model losing focus again and producing non-JSON output.
  const repairUserMessage = 'Your previous response was not valid JSON. Return ONLY the JSON scoring object described in your instructions.';

  try {
    const repairResponse = await llmChat(
      {
        model: model.id,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: repairUserMessage },
        ],
        ...(maxCompletionTokens != null ? { max_completion_tokens: maxCompletionTokens } : {}),
        stream: false,
      },
      model,
      ctx,
    );

    const repairText = String(repairResponse.choices?.[0]?.message?.content ?? '');
    log?.info({ raw: repairText }, 'llm policy: repair response');
    return parseRoutingResponse(repairText, log);
  } catch (err) {
    log?.warn({ err: String(err) }, 'llm policy: repair call failed');
    return null;
  }
}

export const llmPolicy: PolicyFn = async ({ request, candidates, config, log, emit, projectId, token, traceId, conversationId }) => {
  log?.info(
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

  // additionalPromptInfo is only active when autoRouting is explicitly disabled;
  // when autoRouting is true (or unset), treat it as if none was configured.
  const additionalPromptInfo: string | undefined =
    config?.autoRouting === false ? config?.additionalPromptInfo : undefined;

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

  // Memory: recupera le ultime N decisioni di routing per questa conversazione
  let previousDecisions: { model: string }[] | undefined;
  if (config?.memory === true && conversationId && projectId) {
    const memoryCount: number = typeof config?.memoryCount === 'number' && config.memoryCount > 0 ? config.memoryCount : 5;
    const history = getRoutingHistory(projectId, conversationId, memoryCount);
    previousDecisions = history.length > 0 ? history : undefined;
  }

  const userMessage = buildUserMessage(request, previousDecisions, maxUserMessageChars);
  const systemPrompt = buildSystemPrompt(
    candidates.map(c => ({
      id: c.model.id as string,
      ...(c.prompt !== undefined ? { prompt: c.prompt } : {}),
      ...(limitsMap[c.model.id as string]?.length ? { limits: limitsMap[c.model.id as string] } : {}),
    })),
    { ...(additionalPromptInfo !== undefined ? { additionalPromptInfo } : {}), includeReason },
  );

  log?.info(
    {
      systemPromptChars: systemPrompt.length,
      userMessageChars: userMessage.length,
    },
    'llm policy: prompts',
  );

  for (const modelId of candidateModelIds) {
    const model = allModels.find(m => m.id === modelId);
    if (!model) {
      log?.info({ modelId, reason: 'model not found' }, 'llm policy: skipping model');
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

    log?.info(
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
      log?.info({ modelId, rawChars: text.length }, 'llm policy: raw response');

      let routing = parseRoutingResponse(text, log);
      if (!routing) {
        log?.warn({ modelId, reason: 'parse failed, attempting repair' }, 'llm policy: repair');
        emit?.({ panel: 'router-response', message: 'llm-policy:repair', details: { modelId } });
        routing = await repairRoutingResponse(routingModel, systemPrompt, maxCompletionTokens, ctx, log);
      }

      if (!routing) {
        log?.error({ modelId, reason: 'repair failed', raw: text }, 'llm policy: all parse attempts failed, skipping model');
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
        log?.info({ modelId, reason: 'budget_exhausted' }, 'llm policy: skipping model');
        continue;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.warn({ modelId, err: errMsg, reason: 'call failed' }, 'llm policy: skipping model');
      emit?.({ panel: 'router-response', message: 'llm-policy:error', details: { modelId, error: errMsg } });
    }
  }

  throw new Error(`llm policy: all models failed [${candidateModelIds.join(', ')}]`);
};
