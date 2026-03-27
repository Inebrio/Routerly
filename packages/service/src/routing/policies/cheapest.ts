import type { PolicyFn } from './types.js';

/**
 * Policy: cheapest
 *
 * Assegna un punteggio di efficienza di costo proporzionale: il modello più
 * economico ottiene 1.0 e gli altri ricevono il rapporto (minCost / theirCost).
 *
 * Questo evita il problema della normalizzazione min-max che assegnava 0.0
 * al modello più costoso, rendendo impossibile per le altre policy compensare.
 * Con il rapporto proporzionale un modello 2x più caro ottiene 0.5, uno 10x
 * più caro ottiene 0.1 — il segnale è graduale, non binario.
 *
 * Costo medio = (inputPerMillion + outputPerMillion) / 2.
 */
export const cheapestPolicy: PolicyFn = async ({ candidates }) => {
  const costs = candidates.map(c => ({
    id: c.model.id,
    avgCost: (c.model.cost.inputPerMillion + c.model.cost.outputPerMillion) / 2,
  }));

  // Reference minimo solo tra modelli a pagamento (costo > 0).
  // Se usassimo il minimo globale e ci fosse un modello gratuito (es. Ollama),
  // min === 0 → 0/qualsiasi = 0 per tutti i modelli a pagamento.
  const hasFreeModel = costs.some(c => c.avgCost === 0);
  const paidCosts = costs.map(c => c.avgCost).filter(v => v > 0);
  const minPaid   = paidCosts.length > 0 ? Math.min(...paidCosts) : 0;

  // Quando esistono modelli gratuiti, i modelli a pagamento vengono scalati
  // al massimo a 0.5: il modello gratuito supera sempre i modelli a pagamento
  // con un gap visibile e proporzionale (cheapest paid = 0.5, 2x più caro = 0.25...).
  const paidCeiling = hasFreeModel ? 0.5 : 1.0;

  const routing = costs.map(({ id, avgCost }) => ({
    model: id,
    point: avgCost === 0
      ? 1.0                                       // modello gratuito → massimo assoluto
      : paidCeiling * (minPaid / avgCost),         // proporzionale tra paid; se esiste gratuito, max 0.5
    avgCostPerMillion: avgCost,
  }));

  return { routing };
};
