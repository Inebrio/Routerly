import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@localrouter/shared';

/**
 * Policy: fairness
 *
 * Distribuisce il traffico in modo equo tra i candidati, penalizzando i
 * modelli che hanno ricevuto più chiamate di recente (stile round-robin
 * adattivo pesato).
 *
 * Funzionamento:
 *  1. Conta le chiamate *riuscite* per modello nell'ultima finestra.
 *  2. Bonus posizionale (range 0.8-1.0): ordina i modelli per utilizzo e
 *     assegna punteggi decrescenti. Il meno usato 1.0, il più usato 0.8.
 *  3. Penalizzazione molto graduale: massima differenza 20% tra primo e ultimo.
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes  {number}  Finestra temporale osservata   (default: 60)
 *
 * Combinata con altre policy (es. health, performance) assicura che il carico
 * non si concentri sempre sullo stesso modello anche quando i punteggi degli
 * altri criteri sono tutti identici. Non considera il costo: per quello usa
 * la policy 'cheapest' o 'budget-remaining'.
 */
export const fairnessPolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number = config?.windowMinutes ?? 60;

  const records: UsageRecord[] = await readConfig('usage');
  const now      = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const since    = new Date(now - windowMs);

  // Solo le chiamate con esito positivo contribuiscono al conteggio
  const recent = records.filter(
    r => new Date(r.timestamp) >= since && r.outcome === 'success',
  );

  // ── Conta chiamate per candidato ─────────────────────────────────────────
  const counts = candidates.map(c => ({
    modelId:   c.model.id,
    callCount: recent.filter(r => r.modelId === c.model.id).length,
  }));

  // Ordina per callCount crescente: il meno usato primo
  const sorted = [...counts].sort((a, b) => a.callCount - b.callCount);

  // Distribuzione lineare gentile: da 1.0 (meno usato) a 0.8 (più usato)
  // Così c'è sempre differenziazione ma molto graduale
  const MIN_SCORE = 0.8;
  const SCORE_RANGE = 0.2; // range 0.8-1.0
  const n = sorted.length;

  const routing = counts.map(({ modelId, callCount }) => {
    // Trova la posizione di questo modello nell'ordinamento
    const position = sorted.findIndex(s => s.modelId === modelId);

    // Bonus posizionale: primo (meno usato) = 1.0, ultimo = 0.8
    const point = n > 1
      ? MIN_SCORE + (SCORE_RANGE * (n - 1 - position) / (n - 1))
      : 1.0;

    return {
      model: modelId,
      point: Math.max(MIN_SCORE, Math.min(1, point)),
      callCount,
    };
  });

  return { routing };
};
