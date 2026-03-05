import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@localrouter/shared';

/**
 * Policy: performance
 *
 * Valuta i modelli candidati in base alla **latenza media** delle chiamate
 * riuscite. La latenza viene normalizzata con range min–max tra tutti i
 * candidati, così il modello più veloce ottiene 1.0 e il più lento 0.0.
 *
 * Le chiamate con outcome `error` o `timeout` vengono escluse dal calcolo.
 * I modelli senza dati sufficienti ricevono punteggio 1.0 (nessun segnale
 * negativo — vengono preferiti rispetto a quelli con latenza nota elevata).
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes    {number}  Durata della finestra temporale osservata  (default: 20)
 *  - halfLifeMinutes  {number}  Emivita del decadimento esponenziale        (default: 5)
 *                               Usa 0 per una media semplice senza decay.
 *  - minSamples       {number}  Campioni minimi per considerare il modello  (default: 1)
 *                               I modelli con meno campioni ottengono 1.0.
 *
 * Modelli senza record recenti ottengono punto 1.0 (benefit of the doubt).
 */
export const performancePolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number   = config?.windowMinutes   ?? 20;
  const halfLifeMinutes: number = config?.halfLifeMinutes ?? 5;
  const minSamples: number      = config?.minSamples      ?? 1;

  const records: UsageRecord[] = await readConfig('usage');
  const now                    = Date.now();
  const windowMs               = windowMinutes * 60 * 1000;
  const halfLifeMs             = halfLifeMinutes * 60 * 1000;
  const useDecay               = halfLifeMinutes > 0;
  const since                  = new Date(now - windowMs);

  const recent = records.filter(r => new Date(r.timestamp) >= since);

  // ── Calcola latenza media (opzionalmente pesata) per ogni candidato ──────
  const stats = candidates.map(c => {
    const modelRecords = recent.filter(
      r => r.modelId === c.model.id &&
           r.outcome !== 'error' &&
           r.outcome !== 'timeout' &&
           r.latencyMs > 0,
    );

    if (modelRecords.length < minSamples) {
      return { modelId: c.model.id, avgLatencyMs: null as number | null, sampleCount: modelRecords.length };
    }

    let weightedLatency = 0;
    let weightedTotal   = 0;

    for (const r of modelRecords) {
      const weight = useDecay
        ? Math.exp((-Math.LN2 * (now - new Date(r.timestamp).getTime())) / halfLifeMs)
        : 1;
      weightedLatency += r.latencyMs * weight;
      weightedTotal   += weight;
    }

    const avgLatencyMs = weightedTotal > 0 ? weightedLatency / weightedTotal : null;

    return { modelId: c.model.id, avgLatencyMs, sampleCount: modelRecords.length };
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

    return {
      model:         s.modelId,
      point:         Math.max(0, Math.min(1, latencyScore)),
      sampleCount:   s.sampleCount,
      avgLatencyMs:  s.avgLatencyMs,
      latencyScore,
    };
  });

  return { routing };
};
