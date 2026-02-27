import OpenAI from 'openai';
import { decrypt } from '@localrouter/shared';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@localrouter/shared';
import type { ProviderAdapter } from './types.js';

/**
 * Generic adapter for any provider that exposes an OpenAI-compatible API.
 * Requires a custom endpoint in ModelConfig.
 */
export class CustomAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const apiKey = model.encryptedApiKey ? decrypt(model.encryptedApiKey) : 'custom';
    if (!model.endpoint) {
      throw new Error(`Custom provider model "${model.id}" has no endpoint configured.`);
    }
    return new OpenAI({ apiKey, baseURL: model.endpoint });
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
