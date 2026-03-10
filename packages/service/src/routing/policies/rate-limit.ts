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
 *  1. I modelli SENZA limiti di tipo 'calls' configurati ricevono sempre 1.0.
 *  2. Conta le chiamate per modello nell'ultima finestra temporale breve.
 *  3. Se la soglia opzionale `maxCallsPerWindow` è definita e superata →
 *     il modello viene escluso (hard filter via `excludes`).
 *  4. Usa il rapporto proporzionale (minCount / count): il modello meno
 *     usato ottiene 1.0, uno usato 3x tanto ottiene 0.33.
 *  5. I modelli senza chiamate recenti ottengono 1.0.
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - windowMinutes      {number}  Durata della finestra           (default: 1)
 *  - maxCallsPerWindow  {number}  Hard threshold → excludes        (default: nessuno)
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

  // ── Identifica modelli con rate limits configurati ──────────────────────
  const hasCallsLimit = (c: typeof candidates[0]) =>
    c.model.limits?.some(l => l.metric === 'calls') ?? false;

  // ── Conta chiamate recenti per candidato ────────────────────────────────
  const counts = candidates.map(c => ({
    modelId: c.model.id,
    callCount: recent.filter(r => r.modelId === c.model.id).length,
    hasLimit: hasCallsLimit(c),
  }));

  // ── Applica hard threshold (solo ai modelli con limiti) ─────────────────
  const overThreshold = new Set(
    maxCallsPerWindow !== undefined
      ? counts.filter(c => c.hasLimit && c.callCount >= maxCallsPerWindow).map(c => c.modelId)
      : [],
  );

  // ── Punteggio proporzionale per modelli con rate limits ──────────────────
  // Usa il rapporto (minCount / count) per riflettere la pressione reale.
  const eligibleCounts = counts
    .filter(c => c.hasLimit && !overThreshold.has(c.modelId))
    .map(c => ({ modelId: c.modelId, callCount: c.callCount }));

  const nonZeroEligible = eligibleCounts.map(c => c.callCount).filter(n => n > 0);
  const minEligibleCount = nonZeroEligible.length > 0 ? Math.min(...nonZeroEligible) : 0;

  const routing = counts.map(({ modelId, callCount, hasLimit }) => {
    // Modelli senza rate limits: sempre punteggio massimo
    if (!hasLimit) {
      return { model: modelId, point: 1.0, callCount, rateLimited: false, noLimit: true };
    }

    if (overThreshold.has(modelId)) {
      return { model: modelId, point: 0.0, callCount, rateLimited: true };
    }

    // Nessuna chiamata → massimo punteggio
    const point = callCount === 0
      ? 1.0
      : minEligibleCount / callCount;

    return {
      model: modelId,
      point: Math.max(0, Math.min(1, point)),
      callCount,
      rateLimited: false,
    };
  });

  const excludes = [...overThreshold];
  return { routing, ...(excludes.length > 0 ? { excludes } : {}) };
};
