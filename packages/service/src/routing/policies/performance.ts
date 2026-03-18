import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@routerly/shared';

/**
 * Policy: performance
 *
 * Valuta i modelli candidati in base alla **latenza media** delle chiamate
 * riuscite, usando confronto relativo tra i candidati con dati sufficienti.
 *
 * Score = minLatency / avgLatency  (il più veloce prende 1.0, gli altri scalano):
 *  - modello più veloce           → 1.0
 *  - modello 2× più lento         → 0.5
 *  - modello 5× più lento         → 0.2
 *
 * Se 0 o 1 solo modello ha dati sufficienti, tutti ricevono 1.0
 * (il confronto su un singolo punto è privo di significato e causerebbe
 * auto-confronto: l'unico modello confrontato con se stesso ottiene sempre 1.0).
 *
 * Le chiamate con outcome `error` o `timeout` vengono escluse dal calcolo.
 * I modelli senza dati sufficienti ricevono punteggio 1.0 (esplorazione attiva).
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes    {number}  Durata della finestra temporale osservata  (default: 20)
 *  - halfLifeMinutes  {number}  Emivita del decadimento esponenziale        (default: 5)
 *                               Usa 0 per una media semplice senza decay.
 *  - minSamples       {number}  Campioni minimi per considerare il modello  (default: 1)
 *                               I modelli con meno campioni ottengono 1.0.
 */
export const performancePolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number    = config?.windowMinutes    ?? 20;
  const halfLifeMinutes: number  = config?.halfLifeMinutes  ?? 5;
  const minSamples: number       = config?.minSamples       ?? 1;

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

  // ── Confronto relativo: il modello più veloce = 1.0 ────────────────────
  // Se meno di 2 modelli hanno dati, il confronto è privo di significato
  // (auto-confronto su singolo punto → 1.0 garantito). In quel caso tutti
  // ricevono 1.0 per favorire l'esplorazione.
  const withData = stats.filter(s => s.avgLatencyMs !== null);
  const minLatency = withData.length >= 2
    ? Math.min(...withData.map(s => s.avgLatencyMs!))
    : null;

  const routing = stats.map(s => {
    const latencyScore =
      s.avgLatencyMs === null || minLatency === null
        ? 1.0  // nessun dato o confronto impossibile → favorito (esplorazione)
        : minLatency / s.avgLatencyMs;

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
