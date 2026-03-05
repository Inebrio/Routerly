import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@localrouter/shared';

/**
 * Policy: health
 *
 * Valuta la salute di ogni modello candidato in base al **tasso di errore**:
 * gli errori recenti pesano più di quelli vecchi grazie a un decadimento
 * esponenziale. Un "circuit breaker" porta il punteggio a 0 quando il tasso
 * pesato supera una soglia critica.
 *
 * Per la valutazione della latenza/prestazioni usa la policy `performance`.
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes    {number}  Durata della finestra temporale          (default: 20)
 *  - halfLifeMinutes  {number}  Emivita del decadimento esponenziale     (default: 5)
 *  - pseudoCounts     {number}  Pseudo-conteggi Bayesiani (smoothing)    (default: 2)
 *  - circuitBreaker   {number}  Soglia error rate pesato → point = 0     (default: 0.9)
 *
 * Modelli senza record recenti ottengono punto 1.0 (nessun segnale di degrado).
 */
export const healthPolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number   = config?.windowMinutes   ?? 20;
  const halfLifeMinutes: number = config?.halfLifeMinutes ?? 5;
  const pseudoCounts: number    = config?.pseudoCounts    ?? 2;
  const circuitBreaker: number  = config?.circuitBreaker  ?? 0.9;

  const records: UsageRecord[] = await readConfig('usage');
  const now                    = Date.now();
  const windowMs               = windowMinutes * 60 * 1000;
  const halfLifeMs             = halfLifeMinutes * 60 * 1000;
  const since                  = new Date(now - windowMs);

  const recent = records.filter(r => new Date(r.timestamp) >= since);

  const routing = candidates.map(c => {
    const modelRecords = recent.filter(r => r.modelId === c.model.id);

    if (modelRecords.length === 0) {
      return { model: c.model.id, point: 1.0, recentCalls: 0, weightedErrorRate: 0, errorScore: 1.0 };
    }

    let weightedErrors = 0;
    let weightedTotal  = 0;

    for (const r of modelRecords) {
      // W(age) = 2^(-age / halfLife) — decadimento esponenziale
      const ageMs  = now - new Date(r.timestamp).getTime();
      const weight = Math.exp((-Math.LN2 * ageMs) / halfLifeMs);

      const isError = r.outcome === 'error' || r.outcome === 'timeout';
      weightedErrors += isError ? weight : 0;
      weightedTotal  += weight;
    }

    const rawWeightedErrorRate = weightedErrors / weightedTotal;

    // Smoothing Bayesiano: i pseudo-counts agiscono come prior di successo
    const smoothedErrorRate = weightedErrors / (weightedTotal + pseudoCounts);

    // Circuit breaker: tasso grezzo sopra soglia → score = 0
    const errorScore = rawWeightedErrorRate >= circuitBreaker
      ? 0.0
      : 1 - smoothedErrorRate;

    return {
      model:             c.model.id,
      point:             Math.max(0, Math.min(1, errorScore)),
      recentCalls:       modelRecords.length,
      weightedErrorRate: rawWeightedErrorRate,
      errorScore,
    };
  });

  return { routing };
};
