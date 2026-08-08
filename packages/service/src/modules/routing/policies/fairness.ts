import type { PolicyFn } from './types.js';
import { readUsageRecords } from '../../usage/usageStore.js';
import { shareScore } from './scoring.js';

/**
 * Policy: fairness
 *
 * Distribuisce il traffico in modo equo tra i candidati, penalizzando i
 * modelli che hanno ricevuto più chiamate di recente.
 *
 * Funzionamento:
 *  1. Conta le chiamate *riuscite* per modello nell'ultima finestra.
 *  2. Calcola il totale chiamate nel periodo tra tutti i candidati.
 *  3. Score = 1 - (mieChiamate / totaleChiamate):
 *     - nessuna chiamata nel periodo → tutti 1.0
 *     - un modello monopolizza il 100% → score 0.0
 *     - distribuzione perfettamente uniforme (N modelli) → tutti 1 - 1/N
 *  4. Modelli senza chiamate: 1.0 (priorità massima).
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes  {number}  Finestra temporale osservata   (default: 60)
 */
export const fairnessPolicy: PolicyFn = async ({ candidates, config, routerId }) => {
  const windowMinutes: number = config?.windowMinutes ?? 60;

  const records = await readUsageRecords();
  const now      = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const since    = new Date(now - windowMs);

  // Solo le chiamate con esito positivo contribuiscono al conteggio
  const recent = records.filter(
    r => new Date(r.timestamp) >= since && r.outcome === 'success'
         && (routerId === undefined || r.routerId === routerId),
  );

  // ── Conta chiamate per candidato ─────────────────────────────────────────
  const counts = candidates.map(c => ({
    modelId:   c.model.id,
    callCount: recent.filter(r => r.modelId === c.model.id).length,
  }));

  // ── Score = 1 - share, dove share = mieChiamate / totaleChiamate ────────
  const totalCalls = counts.reduce((sum, c) => sum + c.callCount, 0);

  const routing = counts.map(({ modelId, callCount }) => {
    return {
      model: modelId,
      point: shareScore(callCount, totalCalls),
      callCount,
      totalCalls,
    };
  });

  return { routing };
};
