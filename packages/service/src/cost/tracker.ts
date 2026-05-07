import type { UsageRecord, CallType } from '@routerly/shared';
import { appendUsageRecord } from '../config/loader.js';
import { v4 as uuidv4Alias } from 'uuid';
import { calculateCost } from './calculator.js';
import { getTrace } from '../routing/traceStore.js';
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
  traceId?: string;
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
    ...(params.traceId ? { trace: getTrace(params.traceId) ?? [] } : {}),
    ...(params.traceId ? { traceId: params.traceId } : {}),
    costInput,
    costOutput,
    priceInput: params.model.cost.inputPerMillion,
    priceOutput: params.model.cost.outputPerMillion,
  };

  await appendUsageRecord(record);
}

export interface TrackCacheHitParams {
  projectId: string;
  /** Model ID that originally produced the cached response */
  modelId: string;
  /** Tokens from the original response (for informational purposes only, not billed) */
  inputTokens: number;
  outputTokens: number;
  /** Latency to serve the cache hit in ms */
  latencyMs: number;
  /** Cosine similarity score of the matched cache entry */
  cacheSimilarity: number;
  traceId?: string;
}

/**
 * Records a cache-hit event to usage.json.
 * Cost and token billing are zero since no LLM call was made.
 */
export async function trackCacheHit(params: TrackCacheHitParams): Promise<void> {
  const record: UsageRecord = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    projectId: params.projectId,
    modelId: params.modelId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cost: 0,
    latencyMs: params.latencyMs,
    outcome: 'success',
    callType: 'completion',
    cacheHit: true,
    cacheSimilarity: params.cacheSimilarity,
    ...(params.traceId ? { traceId: params.traceId } : {}),
  };
  await appendUsageRecord(record);
}
