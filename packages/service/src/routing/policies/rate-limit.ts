import type { PolicyFn } from './types.js';
import { readConfig } from '../../config/loader.js';
import type { UsageRecord } from '@localrouter/shared';

/**
 * Policy: rate-limit
 *
 * Penalizza i modelli con un'alta frequenza di chiamate recenti per ridurre
 * il rischio di colpire i limiti del provider (429 Too Many Requests).
 *
 * Funzionamento:
 *  1. Conta le chiamate per modello nell'ultima finestra temporale breve.
 *  2. Se la soglia opzionale `maxCallsPerWindow` è definita e superata → point = 0.
 *  3. Normalizzazione inversamente proporzionale (range min–max): il modello
 *     con meno chiamate recenti ottiene 1.0, quello più chiamato ottiene 0.0.
 *  4. I modelli senza chiamate recenti ottengono 1.0.
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes      {number}  Durata della finestra           (default: 1)
 *  - maxCallsPerWindow  {number}  Hard threshold → point = 0      (default: nessuno)
 *
 * Nota: questa policy agisce sulla frequenza di invio, non sul budget. Per
 * la gestione del budget usa la policy `budget-remaining`.
 */
export const rateLimitPolicy: PolicyFn = async ({ candidates, config }) => {
  const windowMinutes: number       = config?.windowMinutes     ?? 1;
  const maxCallsPerWindow: number | undefined = config?.maxCallsPerWindow;

  const records: UsageRecord[] = await readConfig('usage');
  const now      = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const since    = new Date(now - windowMs);

  const recent = records.filter(r => new Date(r.timestamp) >= since);

  // ── Conta chiamate recenti per candidato ────────────────────────────────
  const counts = candidates.map(c => ({
    modelId: c.model.id,
    callCount: recent.filter(r => r.modelId === c.model.id).length,
  }));

  // ── Applica hard threshold ───────────────────────────────────────────────
  const overThreshold = new Set(
    maxCallsPerWindow !== undefined
      ? counts.filter(c => c.callCount >= maxCallsPerWindow).map(c => c.modelId)
      : [],
  );

  // ── Normalizzazione range min–max inversamente proporzionale ────────────
  const eligibleCounts = counts
    .filter(c => !overThreshold.has(c.modelId))
    .map(c => c.callCount);

  const minCalls   = eligibleCounts.length > 0 ? Math.min(...eligibleCounts) : 0;
  const maxCalls   = eligibleCounts.length > 0 ? Math.max(...eligibleCounts) : 0;
  const callsRange = maxCalls - minCalls;

  const routing = counts.map(({ modelId, callCount }) => {
    if (overThreshold.has(modelId)) {
      return { model: modelId, point: 0.0, callCount, rateLimited: true };
    }

    const point = callsRange === 0
      ? 1.0
      : 1 - (callCount - minCalls) / callsRange;

    return {
      model: modelId,
      point: Math.max(0, Math.min(1, point)),
      callCount,
      rateLimited: false,
    };
  });

  return { routing };
};
