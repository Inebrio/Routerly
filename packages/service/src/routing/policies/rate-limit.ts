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
 *  3. Se la soglia opzionale `maxCallsPerWindow` è definita e superata → point = 0.
 *  4. Bonus posizionale (range 0.7-1.0): ordina i modelli per utilizzo e
 *     assegna punteggi decrescenti. Più severo di fairness (30% vs 20%).
 *  5. I modelli senza chiamate recenti ottengono 1.0.
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

  // ── Normalizzazione con bonus posizionale ────────────────────────────────
  // Escludi modelli senza rate limits dalla competizione (riceveranno sempre 1.0)
  const eligibleCounts = counts
    .filter(c => c.hasLimit && !overThreshold.has(c.modelId))
    .map(c => ({ modelId: c.modelId, callCount: c.callCount }));

  // Ordina per callCount crescente: il meno usato primo
  const sorted = [...eligibleCounts].sort((a, b) => a.callCount - b.callCount);

  // Distribuzione lineare: da 1.0 (meno usato) a 0.7 (più usato)
  // Più severa di fairness perché i rate limits sono critici
  const MIN_SCORE = 0.7;
  const SCORE_RANGE = 0.3; // range 0.7-1.0
  const n = sorted.length;

  const routing = counts.map(({ modelId, callCount, hasLimit }) => {
    // Modelli senza rate limits: sempre punteggio massimo
    if (!hasLimit) {
      return { model: modelId, point: 1.0, callCount, rateLimited: false, noLimit: true };
    }

    if (overThreshold.has(modelId)) {
      return { model: modelId, point: 0.0, callCount, rateLimited: true };
    }

    // Trova la posizione di questo modello nell'ordinamento
    const position = sorted.findIndex(s => s.modelId === modelId);

    if (position === -1 || n === 0) {
      return { model: modelId, point: 1.0, callCount, rateLimited: false };
    }

    // Bonus posizionale: primo (meno usato) = 1.0, ultimo = 0.7
    const point = n > 1
      ? MIN_SCORE + (SCORE_RANGE * (n - 1 - position) / (n - 1))
      : 1.0;

    return {
      model: modelId,
      point: Math.max(MIN_SCORE, Math.min(1, point)),
      callCount,
      rateLimited: false,
    };
  });

  return { routing };
};
