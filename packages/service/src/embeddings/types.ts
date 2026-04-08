export type EmbeddingProviderType = 'openai' | 'ollama';

export interface EmbeddingProviderConfig {
  /** Provider type. */
  type: EmbeddingProviderType;
  /** Embedding model ID (e.g. 'text-embedding-3-small', 'nomic-embed-text'). */
  model: string;
  /** Base URL / endpoint override. */
  endpoint?: string;
  /** API key (required for OpenAI). */
  apiKey?: string;
}

export interface EmbedResult {
  /** One float32 vector per input text, in the same order. */
  embeddings: number[][];
  /** Total input tokens consumed by this call (0 when the provider does not report it). */
  inputTokens: number;
}

/** Minimal interface every embedding backend must satisfy. */
export interface EmbeddingProvider {
  /**
   * Embed a batch of texts.
   * Returns the embedding vectors together with the reported input token count.
   */
  embed(texts: string[], model: string): Promise<EmbedResult>;
}
