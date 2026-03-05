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
 *  2. Normalizzazione inversa (range min–max): il modello meno usato
 *     ottiene 1.0, quello più usato ottiene 0.0.
 *  3. I modelli senza chiamate recenti ottengono 1.0 (vengono preferiti).
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes  {number}  Finestra temporale osservata   (default: 60)
 *
 * Combinata con altre policy (es. health, performance) assicura che il carico
 * non si concentri sempre sullo stesso modello anche quando i punteggi degli
 * altri criteri sono tutti identici.
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

  const values     = counts.map(c => c.callCount);
  const minCalls   = Math.min(...values);
  const maxCalls   = Math.max(...values);
  const callsRange = maxCalls - minCalls;

  const routing = counts.map(({ modelId, callCount }) => {
    // Inversione: meno chiamate → punto più alto
    const point = callsRange === 0
      ? 1.0
      : 1 - (callCount - minCalls) / callsRange;

    return {
      model: modelId,
      point: Math.max(0, Math.min(1, point)),
      callCount,
    };
  });

  return { routing };
};
