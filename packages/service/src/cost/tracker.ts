import type { UsageRecord } from '@localrouter/shared';
import { appendUsageRecord } from '../config/loader.js';
import { calculateCost } from './calculator.js';
import type { ModelConfig } from '@localrouter/shared';
import { v4 as uuidv4 } from 'uuid';

export interface TrackUsageParams {
  projectId: string;
  model: ModelConfig;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  outcome: UsageRecord['outcome'];
  errorMessage?: string;
}

/**
 * Records a usage event to usage.json after each API call.
 */
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  const cost = calculateCost(params.inputTokens, params.outputTokens, params.model);

  const record: UsageRecord = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    projectId: params.projectId,
    modelId: params.model.id,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cost,
    latencyMs: params.latencyMs,
    outcome: params.outcome,
    errorMessage: params.errorMessage,
  };

  await appendUsageRecord(record);
}
