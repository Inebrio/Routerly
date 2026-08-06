import { defineModule } from '../../core/index.js';
import { EMBEDDINGS } from '../../core/tokens.js';
import { getEmbeddingProvider } from './dispatch.js';

/**
 * Embeddings module: owns the real dispatcher (dispatch.ts, a flat
 * type-switch over openai.ts/ollama.ts, no hook-based override) and exposes
 * it behind the EMBEDDINGS DI token. Other files still import dispatch.ts
 * directly by path; this module additionally makes it reachable through the
 * container.
 */
export const embeddingsModule = defineModule({
  manifest: { id: 'embeddings', version: '0.4.0' },
  register({ container }) {
    container.register(EMBEDDINGS, { getEmbeddingProvider });
  },
});
