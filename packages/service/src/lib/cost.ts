import type { ModelConfig } from '@routerly/shared';

const warnedNoCacheRate = new Set<string>();

/**
 * Calculates the cost of a single API call in USD.
 *
 * Token pricing tiers (all optional):
 *  - inputTokens (minus cached and creation) → inputPerMillion
 *  - cachedInputTokens (cache read)          → cachePerMillion  (fallback: inputPerMillion)
 *  - cacheCreationInputTokens (cache write)  → cacheWritePerMillion (fallback: inputPerMillion)
 *  - outputTokens                            → outputPerMillion
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelConfig,
  cachedInputTokens = 0,
  cacheCreationInputTokens = 0,
): number {
  if (cachedInputTokens > 0 && model.cost.cachePerMillion === undefined && !warnedNoCacheRate.has(model.id)) {
    warnedNoCacheRate.add(model.id);
    console.warn(`[cost] model "${model.id}" has no cachePerMillion: cache reads are billed at inputPerMillion (may overstate spend). Set cachePerMillion to price them correctly.`);
  }
  const plainInput = inputTokens - cachedInputTokens - cacheCreationInputTokens;
  const inputCost        = (plainInput               / 1_000_000) * model.cost.inputPerMillion;
  const cachedCost       = (cachedInputTokens         / 1_000_000) * (model.cost.cachePerMillion       ?? model.cost.inputPerMillion);
  const cacheCreateCost  = (cacheCreationInputTokens  / 1_000_000) * (model.cost.cacheWritePerMillion  ?? model.cost.inputPerMillion);
  const outputCost       = (outputTokens              / 1_000_000) * model.cost.outputPerMillion;
  return Math.round((inputCost + cachedCost + cacheCreateCost + outputCost) * 1_000_000_000) / 1_000_000_000;
}
