import type { ModelConfig, ProjectConfig, RoutingResponse } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { isAllowed } from '../cost/budget.js';

/**
 * Selects the best available model from a routing response,
 * checking budget thresholds and skipping exhausted models.
 *
 * @returns The selected ModelConfig, or null if all candidates failed
 */
export async function selectModel(
  routingResponse: RoutingResponse,
  project: ProjectConfig,
): Promise<ModelConfig | null> {
  const allModels = await readConfig('models');

  // Sort candidates by weight descending (highest priority first)
  const sorted = [...routingResponse.models].sort((a, b) => b.weight - a.weight);

  for (const candidate of sorted) {
    const modelConfig = allModels.find((m: ModelConfig) => m.id === candidate.model);
    if (!modelConfig) continue;

    const allowed = await isAllowed(modelConfig, project);
    if (allowed) return modelConfig;
  }

  return null;
}
