import type { PolicyFn } from './types.js';
import { getLimitUsageSnapshot } from '../../cost/budget.js';
import { readConfig } from '../../config/loader.js';

/**
 * Policy: budget-remaining
 *
 * Preferisce i modelli con più headroom di budget rimanente, aiutando a
 * distribuire il consumo prima che i limiti siano raggiunti.
 *
 * Funzionamento:
 *  1. Per ogni candidato ottiene lo snapshot corrente dei limiti configurati
 *     (globali, per-progetto, per-token) tramite getLimitUsageSnapshot.
 *  2. Calcola il rapporto di headroom per ogni limite attivo:
 *       headroom = (value - current) / value
 *  3. Prende il minimo headroom tra tutti i limiti del modello (il collo di bottiglia).
 *  4. Usa il valore di headroom direttamente come punteggio (0–1).
 *
 * Casi speciali:
 *  - Nessun limite configurato     → headroom = 1.0 (capacità illimitata)
 *  - Limite già superato           → headroom = 0.0 (già escluso dal pre-filtro,
 *                                    ma incluso per completezza)
 */
export const budgetRemainingPolicy: PolicyFn = async ({ candidates, config: _, token, projectId }) => {
  const allProjects = await readConfig('projects');

  // Usa il projectId dell'input per trovare il progetto corrente
  const project = (allProjects as any[]).find((p: any) => p.id === projectId);

  const headrooms = await Promise.all(
    candidates.map(async c => {
      if (!project) {
        return { modelId: c.model.id, minHeadroom: 1.0, snapshotCount: 0 };
      }

      const snapshots = await getLimitUsageSnapshot(c.model, project, token);

      if (snapshots.length === 0) {
        return { modelId: c.model.id, minHeadroom: 1.0, snapshotCount: 0 };
      }

      // Headroom mínimo tra tutti i limiti attivi (collo di bottiglia)
      const minHeadroom = snapshots.reduce((min, s) => {
        const headroom = s.value > 0 ? Math.max(0, (s.value - s.current) / s.value) : 0;
        return Math.min(min, headroom);
      }, 1.0);

      return { modelId: c.model.id, minHeadroom, snapshotCount: snapshots.length };
    }),
  );

  // ── Punteggio diretto dall'headroom ───────────────────────────────────────
  // L'headroom è già un valore 0–1 con semantica chiara:
  //   1.0 = budget intatto, 0.0 = budget esaurito.
  // Usarlo direttamente preserva l'informazione assoluta (un modello al 70%
  // di budget rimane 0.7, non diventa 0.0 perché un altro ha il 90%).

  const routing = headrooms.map(({ modelId, minHeadroom: mh, snapshotCount }) => ({
    model:          modelId,
    point:          Math.max(0, Math.min(1, mh)),
    minHeadroom:    +mh.toFixed(4),
    snapshotCount,
  }));

  return { routing };
};
