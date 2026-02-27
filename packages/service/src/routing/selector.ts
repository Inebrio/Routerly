import type { ModelConfig, ProjectConfig, RoutingResponse } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { isAllowed } from '../cost/budget.js';

/**
 * Selects the best available model from the routing response,
 * checking budget thresholds and skipping exhausted models.
 *
 * @returns The selected ModelConfig, or null if all candidates failed
 */
export async function selectModel(
  routingResponse: RoutingResponse,
  project: ProjectConfig,
): Promise<ModelConfig | null> {
  const allModels = await readConfig('models');

  // Sort by weight descending
  const sorted = [...routingResponse.models].sort((a, b) => b.weight - a.weight);

  for (const candidate of sorted) {
    const model = allModels.find((m) => m.id === candidate.model);
    if (!model) continue; // unknown model ID, skip

    const allowed = await isAllowed(model, project);
    if (allowed) {
      return model;
    }
  }

  return null;
}
