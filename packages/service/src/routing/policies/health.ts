import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@localrouter/shared';

/**
 * Policy: health
 * Legge i record di usage degli ultimi 10 minuti e calcola il tasso
 * di errore per ogni modello. Assegna:
 *   point = 1 - errorRate   (0.0 = tutti errori, 1.0 = nessun errore)
 * Modelli senza dati recenti ottengono punto 1.0 (nessun errore noto).
 */
export const healthPolicy: PolicyFn = async ({ candidates }) => {
  const records: UsageRecord[] = await readConfig('usage');
  const windowMs = 10 * 60 * 1000; // 10 minuti
  const since = new Date(Date.now() - windowMs);

  const recent = records.filter(r => new Date(r.timestamp) >= since);

  const routing = candidates.map(c => {
    const modelRecords = recent.filter(r => r.modelId === c.model.id);
    if (modelRecords.length === 0) {
      return { model: c.model.id, point: 1.0, recentCalls: 0, errorRate: 0 };
    }
    const errors = modelRecords.filter(r => r.outcome === 'error' || r.outcome === 'timeout').length;
    const errorRate = errors / modelRecords.length;
    return {
      model: c.model.id,
      point: 1 - errorRate,
      recentCalls: modelRecords.length,
      errorRate,
    };
  });

  return { routing };
};
