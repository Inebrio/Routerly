import OpenAI from 'openai';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@localrouter/shared';
import type { ProviderAdapter } from './types.js';

/**
 * Ollama adapter — uses the OpenAI-compatible endpoint exposed by Ollama.
 * No API key required. Default endpoint: http://localhost:11434/v1
 */
export class OllamaAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const baseURL = model.endpoint || 'http://localhost:11434/v1';
    return new OpenAI({ apiKey: 'ollama', baseURL });
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...rest, stream: false } as any);
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = await client.chat.completions.create({ ...rest, stream: true } as any);
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }
}
