import type { ModelConfig, ProjectConfig, RoutingResponse } from '@localrouter/shared';

/**
 * Selects the best available model from a routing response,
 * checking budget thresholds and skipping exhausted models.
 *
 * TODO: Implement model selection logic.
 *   1. Sort candidates by weight descending.
 *   2. For each candidate, check budget with isAllowed().
 *   3. Return the first allowed model, or null if all are exhausted.
 *
 * @returns The selected ModelConfig, or null if all candidates failed
 */
export async function selectModel(
  _routingResponse: RoutingResponse,
  _project: ProjectConfig,
): Promise<ModelConfig | null> {
  throw new Error('Model selection not implemented yet.');
}
