import type { PolicyFn } from './types.js';

/**
 * Policy: context
 * Stima i token della richiesta e verifica se ogni modello può contenerla.
 *
 * Logica:
 *  - La presenza di contesto sufficiente è un requisito binario, non un
 *    vantaggio proporzionale: un modello da 64 k che gestisce una richiesta
 *    da 10 k è un fit perfetto quanto un modello da 200 k — non deve essere
 *    penalizzato perché ha "meno margine libero".
 *  - Si applica una penalità solo quando si è nella zona di rischio
 *    (> WARN_THRESHOLD del contesto occupato), per segnalare che la
 *    richiesta è vicina al limite.
 *  - Se si supera il contesto disponibile il punteggio è 0 (hard block).
 *
 * Stima grossolana: 1 token ≈ 4 caratteri (approx. GPT tokenizer).
 * Se il modello non ha contextWindow configurata si assume capacità illimitata.
 */

const WARN_THRESHOLD = 0.80; // sopra l'80% di utilizzo inizia la penalità
const MIN_SCORE      = 0.10; // punteggio minimo per una richiesta quasi al limite

export const contextPolicy: PolicyFn = async ({ request, candidates }) => {
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
      // richiesta sicuramente troppo lunga → hard block
      point = 0.0;
    } else {
      const usage = estimatedTokens / ctx;
      if (usage <= WARN_THRESHOLD) {
        // richiesta ampiamente nella finestra → punto pieno
        point = 1.0;
      } else {
        // zona di rischio: penalità lineare da 1.0 a MIN_SCORE
        // nell'intervallo [WARN_THRESHOLD, 1.0)
        const t = (usage - WARN_THRESHOLD) / (1 - WARN_THRESHOLD);
        point = 1.0 - t * (1.0 - MIN_SCORE);
      }
    }

    return { model: c.model.id, point, estimatedTokens, contextWindow: ctx ?? null };
  });

  const excludes = routing.filter(r => r.point === 0.0).map(r => r.model);
  return { routing, ...(excludes.length > 0 ? { excludes } : {}) };
};
