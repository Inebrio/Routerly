import type { UsageRecord, CallType } from '@routerly/shared';
import { appendUsageRecord } from '../config/loader.js';
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
  };

  await appendUsageRecord(record);
}
