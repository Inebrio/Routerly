import type { PolicyFn } from './types.js';

const VIRTUAL_MODEL = 'routerly/ada';

/**
 * Policy: model-preference
 *
 * Quando il client richiede un modello specifico (non routerly/ada), assegna
 * un bonus al modello richiesto e 0.0 agli altri.
 * Quando il modello richiesto è routerly/ada (o assente), tutti i candidati
 * ricevono 0.5 → la policy astiene automaticamente per il meccanismo del router.
 *
 * Configurazione (policy.config, tutti opzionali):
 *  - bonus  {number}  Punteggio assegnato al modello richiesto  (default: 1.0)
 */
export const modelPreferencePolicy: PolicyFn = async ({ request, candidates, config }) => {
  const bonus: number = config?.bonus ?? 1.0;
  const requestedModel = request.model;

  // No preference expressed: abstain
  if (!requestedModel || requestedModel === VIRTUAL_MODEL) {
    return {
      routing: candidates.map(c => ({ model: c.model.id, point: 0.5 })),
    };
  }

  return {
    routing: candidates.map(c => ({
      model: c.model.id,
      point: c.model.id === requestedModel ? bonus : 0.0,
      requested: c.model.id === requestedModel,
    })),
  };
};
