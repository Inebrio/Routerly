import type { PolicyFn } from './types.js';
import { readUsageRecords } from '../../usage/usageStore.js';
import { decayWeightedErrorScore } from './scoring.js';

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
 * Modelli senza record recenti ottengono punto 1.0 (nessun segnale di degrado, esplorazione attiva).
 */
export const healthPolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number   = config?.windowMinutes   ?? 20;
  const halfLifeMinutes: number = config?.halfLifeMinutes ?? 5;
  const pseudoCounts: number    = config?.pseudoCounts    ?? 2;
  const circuitBreaker: number  = config?.circuitBreaker  ?? 0.9;

  const records = await readUsageRecords();
  const now                    = Date.now();
  const windowMs               = windowMinutes * 60 * 1000;
  const halfLifeMs             = halfLifeMinutes * 60 * 1000;
  const since                  = new Date(now - windowMs);

  const recent = records.filter(r => new Date(r.timestamp) >= since);

  const routing = candidates.map(c => {
    // Exclude guardrail-blocked records: the model never ran, so they must not
    // dilute the error-rate denominator (consistent with the health endpoint, #77).
    const modelRecords = recent.filter(r => r.modelId === c.model.id && r.outcome !== 'blocked');

    const { point, weightedErrorRate, errorScore } = decayWeightedErrorScore(
      modelRecords, now, halfLifeMs, pseudoCounts, circuitBreaker,
    );

    return {
      model:             c.model.id,
      point,
      recentCalls:       modelRecords.length,
      weightedErrorRate,
      errorScore,
    };
  });

  const excludes = routing.filter(r => r.point === 0.0).map(r => r.model);
  return { routing, ...(excludes.length > 0 ? { excludes } : {}) };
};
