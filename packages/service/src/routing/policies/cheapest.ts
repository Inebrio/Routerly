import type { PolicyFn } from './types.js';

/**
 * Policy: cheapest
 * Normalizza il costo medio per token tra tutti i candidati e assegna
 * punto 1.0 al più economico, 0.0 al più costoso.
 * Costo medio = (inputPerMillion + outputPerMillion) / 2.
 */
export const cheapestPolicy: PolicyFn = async ({ candidates }) => {
  const costs = candidates.map(c => ({
    id: c.model.id,
    avgCost: (c.model.cost.inputPerMillion + c.model.cost.outputPerMillion) / 2,
  }));

  const min = Math.min(...costs.map(c => c.avgCost));
  const max = Math.max(...costs.map(c => c.avgCost));
  const range = max - min;

  const routing = costs.map(({ id, avgCost }) => ({
    model: id,
    point: range === 0 ? 1.0 : 1 - (avgCost - min) / range,
    avgCostPerMillion: avgCost,
  }));

  return { routing };
};
