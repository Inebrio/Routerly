import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@localrouter/shared';

/**
 * Policy: health
 *
 * Valuta la salute di ogni modello candidato combinando due dimensioni:
 *
 *  1. **Tasso di errore con decadimento esponenziale**: gli errori recenti pesano
 *     più di quelli vecchi. Un "circuit breaker" porta il punteggio a 0 quando il
 *     tasso pesato supera una soglia critica.
 *
 *  2. **Latenza media normalizzata**: calcolata solo sulle chiamate andate a buon
 *     fine. Il modello più lento riceve lo score più basso, il più veloce il più alto.
 *
 * Lo score finale è una media pesata dei due componenti.
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes    {number}  Durata della finestra temporale          (default: 20)
 *  - halfLifeMinutes  {number}  Emivita del decadimento esponenziale     (default: 5)
 *  - errorWeight      {number}  Peso del punteggio errori [0–1]          (default: 0.7)
 *  - pseudoCounts     {number}  Pseudo-conteggi Bayesiani (smoothing)    (default: 2)
 *  - circuitBreaker   {number}  Soglia error rate pesato → point = 0     (default: 0.9)
 *
 * Modelli senza record recenti ottengono punto 1.0 (nessun segnale di degrado).
 */
export const healthPolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number      = config?.windowMinutes   ?? 20;
  const halfLifeMinutes: number    = config?.halfLifeMinutes ?? 5;
  const errorWeight: number        = Math.min(1, Math.max(0, config?.errorWeight ?? 0.7));
  const latencyWeight: number      = 1 - errorWeight;
  const pseudoCounts: number       = config?.pseudoCounts    ?? 2;
  const circuitBreaker: number     = config?.circuitBreaker  ?? 0.9;

  const records: UsageRecord[]     = await readConfig('usage');
  const now                        = Date.now();
  const windowMs                   = windowMinutes * 60 * 1000;
  const halfLifeMs                 = halfLifeMinutes * 60 * 1000;
  const since                      = new Date(now - windowMs);

  const recent = records.filter(r => new Date(r.timestamp) >= since);

  // ── Calcola score errori e latenza per ogni candidato ────────────────────
  const stats = candidates.map(c => {
    const modelRecords = recent.filter(r => r.modelId === c.model.id);

    if (modelRecords.length === 0) {
      return { modelId: c.model.id, errorScore: 1.0, avgLatencyMs: null as number | null, recentCalls: 0, weightedErrorRate: 0 };
    }

    let weightedErrors = 0;
    let weightedTotal  = 0;
    let totalLatency   = 0;
    let latencyCount   = 0;

    for (const r of modelRecords) {
      // W(age) = 2^(-age / halfLife) — decadimento esponenziale
      const ageMs  = now - new Date(r.timestamp).getTime();
      const weight = Math.exp((-Math.LN2 * ageMs) / halfLifeMs);

      const isError = r.outcome === 'error' || r.outcome === 'timeout';
      weightedErrors += isError ? weight : 0;
      weightedTotal  += weight;

      // Latenza: solo chiamate riuscite, escludi valori nulli/zero
      if (!isError && r.latencyMs > 0) {
        totalLatency += r.latencyMs;
        latencyCount++;
      }
    }

    const rawWeightedErrorRate = weightedErrors / weightedTotal;

    // Smoothing Bayesiano: i pseudo-counts agiscono come prior di successo
    const smoothedErrorRate = weightedErrors / (weightedTotal + pseudoCounts);

    // Circuit breaker: tasso grezzo sopra soglia → score = 0
    const errorScore = rawWeightedErrorRate >= circuitBreaker
      ? 0.0
      : 1 - smoothedErrorRate;

    const avgLatencyMs = latencyCount > 0 ? totalLatency / latencyCount : null;

    return {
      modelId: c.model.id,
      errorScore,
      avgLatencyMs,
      recentCalls: modelRecords.length,
      weightedErrorRate: rawWeightedErrorRate,
    };
  });

  // ── Normalizza latenza tra i candidati (range min–max) ───────────────────
  const latencies   = stats.map(s => s.avgLatencyMs).filter((v): v is number => v !== null);
  const minLatency  = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency  = latencies.length > 0 ? Math.max(...latencies) : 0;
  const latencyRange = maxLatency - minLatency;

  const routing = stats.map(s => {
    const latencyScore =
      s.avgLatencyMs === null || latencyRange === 0
        ? 1.0  // nessun dato o tutti identici → punteggio neutro
        : 1 - (s.avgLatencyMs - minLatency) / latencyRange;

    const point = Math.max(0, Math.min(1,
      errorWeight * s.errorScore + latencyWeight * latencyScore,
    ));

    return {
      model:             s.modelId,
      point,
      recentCalls:       s.recentCalls,
      weightedErrorRate: s.weightedErrorRate,
      errorScore:        s.errorScore,
      latencyScore,
      avgLatencyMs:      s.avgLatencyMs,
    };
  });

  return { routing };
};
