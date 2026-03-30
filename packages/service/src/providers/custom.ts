import OpenAI from 'openai';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';

/**
 * Generic adapter for any provider that exposes an OpenAI-compatible API.
 * Requires a custom endpoint in ModelConfig.
 */
export class CustomAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const apiKey = model.apiKey ?? 'custom';
    if (!model.endpoint) {
      throw new Error(`Custom provider model "${model.id}" has no endpoint configured.`);
    }
    return new OpenAI({ apiKey, baseURL: model.endpoint });
  }

  // Resolve the model identifier to send to the upstream API.
  // Prefers the explicit upstreamModelId field; falls back to stripping the provider prefix.
  // e.g. upstreamModelId="deepseek-reasoner" → "deepseek-reasoner"
  // e.g. id="deepseek/deepseek-r1" (no upstreamModelId) → "deepseek-r1"
  private getUpstreamModelId(model: ModelConfig): string {
    if (model.upstreamModelId) return model.upstreamModelId;
    if (model.id.includes('/')) {
      return model.id.split('/').slice(1).join('/');
    }
    return model.id;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...rest, model: upstreamModel, stream: false } as any);
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...rest, model: upstreamModel, stream: true } as any);
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }
}
