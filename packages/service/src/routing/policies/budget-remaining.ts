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
 *  4. Normalizzazione range min–max tra i candidati: il modello con più
 *     headroom ottiene 1.0, quello con meno ottiene 0.0.
 *
 * Casi speciali:
 *  - Nessun limite configurato     → headroom = 1.0 (capacità illimitata)
 *  - Limite già superato           → headroom = 0.0 (già escluso dal pre-filtro,
 *                                    ma incluso per completezza)
 *
 * Nota: questa policy *non* esclude modelli (non sostituisce il pre-filtro del
 * router). È un segnale morbido che anticipa l'esaurimento del budget.
 */
export const budgetRemainingPolicy: PolicyFn = async ({ candidates, config: _, token, projectId }) => {
  const allProjects = await readConfig('projects');

  // Usa il projectId dell'input per trovare il progetto corrente
  const project = (allProjects as any[]).find((p: any) => p.id === projectId);

  const headrooms = await Promise.all(
    candidates.map(async c => {
      // Trova il primo progetto che contiene questo modello
      const project = (allProjects as any[]).find(
        (p: any) => Array.isArray(p.models) && p.models.some((m: any) => m.modelId === c.model.id),
      );

      if (!project) {
        // Modello non associato a nessun progetto con limiti noti → nessun segnale
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

  // ── Normalizzazione range min–max ────────────────────────────────────────
  const values      = headrooms.map(h => h.minHeadroom);
  const minHeadroom = Math.min(...values);
  const maxHeadroom = Math.max(...values);
  const range       = maxHeadroom - minHeadroom;

  const routing = headrooms.map(({ modelId, minHeadroom: mh, snapshotCount }) => {
    const point = range === 0 ? 1.0 : (mh - minHeadroom) / range;

    return {
      model:          modelId,
      point:          Math.max(0, Math.min(1, point)),
      minHeadroom:    +mh.toFixed(4),
      snapshotCount,
    };
  });

  return { routing };
};
