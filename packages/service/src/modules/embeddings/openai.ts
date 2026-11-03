import OpenAI from 'openai';
import type { EmbeddingProvider, EmbedResult } from './types.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(endpoint?: string, apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey ?? '',
      baseURL: endpoint ?? 'https://api.openai.com/v1',
    });
  }

  async embed(texts: string[], model: string): Promise<EmbedResult> {
    const response = await this.client.embeddings.create({
      model,
      input: texts,
      encoding_format: 'float',
    });
    return {
      // The API returns results in the same order as inputs.
      embeddings: response.data.map(d => d.embedding),
      inputTokens: response.usage?.prompt_tokens ?? 0,
    };
  }
}
