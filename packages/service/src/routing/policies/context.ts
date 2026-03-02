import type { PolicyFn } from './types.js';

/**
 * Policy: context
 * Stima i token della richiesta e assegna punto pieno ai modelli con
 * contextWindow sufficiente; penalizza quelli che rischiano di non contenerla.
 *
 * Stima grossolana: 1 token ≈ 4 caratteri (approx. GPT tokenizer).
 * Se il modello non ha contextWindow configurata assume capacità illimitata.
 */
export const contextPolicy: PolicyFn = async ({ request, candidates }) => {
  // Stima token totali nella richiesta
  const totalChars = (request.messages ?? []).reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    if (Array.isArray(m.content)) {
      return sum + m.content.reduce((s, p) => s + (p.text?.length ?? 0), 0);
    }
    return sum;
  }, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  const routing = candidates.map(c => {
    const ctx = c.model.contextWindow;
    let point: number;
    if (!ctx) {
      // nessun limite noto → punto pieno
      point = 1.0;
    } else if (estimatedTokens >= ctx) {
      // richiesta sicuramente troppo lunga
      point = 0.0;
    } else {
      // più spazio libero → punto più alto
      point = 1 - estimatedTokens / ctx;
    }
    return { model: c.model.id, point, estimatedTokens, contextWindow: ctx ?? null };
  });

  return { routing };
};
