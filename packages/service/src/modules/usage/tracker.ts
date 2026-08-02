import type { UsageRecord, CallType, OptimizerCallStat, RequestType } from '@routerly/shared';
import { appendUsageRecord } from '../config/loader.js';
import { calculateCost } from '../../lib/cost.js';
import { getTrace } from '../trace/store.js';
import type { ModelConfig } from '@routerly/shared';
import { v4 as uuidv4 } from 'uuid';

export interface TrackUsageParams {
  projectId: string;
  model: ModelConfig;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from prompt cache read (subset of inputTokens, billed at cachePerMillion rate) */
  cachedInputTokens?: number;
  /** Input tokens written to prompt cache — Anthropic only (billed at cacheWritePerMillion rate) */
  cacheCreationInputTokens?: number;
  latencyMs: number;
  ttftMs?: number;
  outcome: UsageRecord['outcome'];
  errorMessage?: string;
  callType?: CallType;
  /** What the call asked for. Defaults to 'chat': everything routed through the executor is a chat-shaped call (T60) */
  requestType?: RequestType;
  traceId?: string;
  /** End-user id from OpenAI `user` field (#96) */
  endUserId?: string;
  /** Session identifier — groups related calls for cost attribution */
  sessionId?: string;
  /** Arbitrary key-value tags — for cost attribution and filtering */
  tags?: Record<string, string>;
  /** Name of the guardrail rule that triggered on this request (#77) */
  guardrailTriggered?: string;
  /** Guardrail rule that blocked the request (set with outcome 'blocked') (#77) */
  blockedBy?: string;
  /** PII entity types redacted before forwarding (#76) */
  piiRedacted?: string[];
  /** What each optimizer step removed from this prompt, changed steps only (T63) */
  optimizerStats?: OptimizerCallStat[];
  /** Experiment that routed this call, and the variant it drew (T71) */
  experimentId?: string;
  experimentVariantId?: string;
}

/**
 * Records a usage event to usage.json after each API call.
 */
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  const cost = calculateCost(
    params.inputTokens,
    params.outputTokens,
    params.model,
    params.cachedInputTokens,
    params.cacheCreationInputTokens,
  );

  // Calculate input/output cost breakdown for reporting
  const plainInput = params.inputTokens - (params.cachedInputTokens ?? 0) - (params.cacheCreationInputTokens ?? 0);
  const costInput = Math.round((
    (plainInput / 1_000_000) * params.model.cost.inputPerMillion +
    ((params.cachedInputTokens ?? 0) / 1_000_000) * (params.model.cost.cachePerMillion ?? params.model.cost.inputPerMillion) +
    ((params.cacheCreationInputTokens ?? 0) / 1_000_000) * (params.model.cost.cacheWritePerMillion ?? params.model.cost.inputPerMillion)
  ) * 1_000_000_000) / 1_000_000_000;
  const costOutput = Math.round(((params.outputTokens / 1_000_000) * params.model.cost.outputPerMillion) * 1_000_000_000) / 1_000_000_000;

  const record: UsageRecord = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    projectId: params.projectId,
    modelId: params.model.id,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    ...(params.cachedInputTokens ? { cachedInputTokens: params.cachedInputTokens } : {}),
    ...(params.cacheCreationInputTokens ? { cacheCreationInputTokens: params.cacheCreationInputTokens } : {}),
    cost,
    latencyMs: params.latencyMs,
    ...(params.ttftMs !== undefined ? { ttftMs: params.ttftMs } : {}),
    ...(params.latencyMs > 0 ? { tokensPerSec: Math.round((params.inputTokens + params.outputTokens) / (params.latencyMs / 1000)) } : {}),
    outcome: params.outcome,
    ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
    callType: params.callType ?? 'completion',
    requestType: params.requestType ?? 'chat',
    ...(params.traceId ? { trace: getTrace(params.traceId) ?? [] } : {}),
    ...(params.traceId ? { traceId: params.traceId } : {}),
    costInput,
    costOutput,
    priceInput: params.model.cost.inputPerMillion,
    priceOutput: params.model.cost.outputPerMillion,
    ...(params.endUserId ? { endUserId: params.endUserId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.tags ? { tags: params.tags } : {}),
    ...(params.guardrailTriggered ? { guardrailTriggered: params.guardrailTriggered } : {}),
    ...(params.blockedBy ? { blockedBy: params.blockedBy } : {}),
    ...(params.piiRedacted && params.piiRedacted.length > 0 ? { piiRedacted: params.piiRedacted } : {}),
    ...(params.optimizerStats && params.optimizerStats.length > 0 ? { optimizers: params.optimizerStats } : {}),
    ...(params.experimentId ? { experimentId: params.experimentId } : {}),
    ...(params.experimentVariantId ? { experimentVariantId: params.experimentVariantId } : {}),
  };

  await appendUsageRecord(record);
}
