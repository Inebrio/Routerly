import type { EmbeddingProvider, EmbeddingProviderType } from './types.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';

export type { EmbeddingProvider, EmbeddingProviderType };
export type { EmbeddingProviderConfig } from './types.js';

export function getEmbeddingProvider(
  type: EmbeddingProviderType,
  endpoint?: string,
  apiKey?: string,
): EmbeddingProvider {
  switch (type) {
    case 'openai':
      return new OpenAIEmbeddingProvider(endpoint, apiKey);
    case 'ollama':
      return new OllamaEmbeddingProvider(endpoint);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown embedding provider type: "${String(_exhaustive)}"`);
    }
  }
}
