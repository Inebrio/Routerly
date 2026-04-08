import type { EmbeddingProvider, EmbedResult } from './types.js';

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseURL: string;

  constructor(endpoint?: string) {
    this.baseURL = (endpoint ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  async embed(texts: string[], model: string): Promise<EmbedResult> {
    const url = `${this.baseURL}/api/embed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding request failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as OllamaEmbedResponse;
    // Ollama does not report token counts for embedding calls.
    return { embeddings: json.embeddings, inputTokens: 0 };
  }
}
