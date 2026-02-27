import type { ModelConfig } from '@localrouter/shared';

/**
 * Calculates the cost of a single API call in USD.
 *
 * @param inputTokens - Number of prompt/input tokens consumed
 * @param outputTokens - Number of completion/output tokens consumed
 * @param model - The model config with pricing (cost per 1M tokens)
 * @returns Cost in USD
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelConfig,
): number {
  const inputCost = (inputTokens / 1_000_000) * model.cost.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // Round to 6 decimal places
}
