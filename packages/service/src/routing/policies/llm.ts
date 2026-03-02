import type { PolicyFn } from './types.js';

/**
 * Policy: llm
 * Delega la decisione di routing a un LLM configurato nel progetto.
 * Il modello di routing riceve la richiesta originale e restituisce
 * una lista pesata di modelli candidati in JSON.
 * TODO: implementazione
 */
export const llmPolicy: PolicyFn = async ({ candidates }) => {
  return {
    routing: candidates.map(c => ({ model: c.model.id, point: 1.0 })),
  };
};
