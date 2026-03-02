import OpenAI from 'openai';
import { decrypt } from '@localrouter/shared';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@localrouter/shared';
import type { ProviderAdapter } from './types.js';

export class OpenAIAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const apiKey = model.encryptedApiKey ? decrypt(model.encryptedApiKey) : '';
    return new OpenAI({
      apiKey,
      baseURL: model.endpoint || 'https://api.openai.com/v1',
      timeout: 10000, // 10s timeout to prevent routing deadlocks
    });
  }

  // Helper to extract the actual upstream model string
  private getUpstreamModelId(model: ModelConfig): string {
    // If the ID contains a slash (e.g., 'openai/gpt-4o'), take the part after the slash
    if (model.id.includes('/')) {
      return model.id.split('/').slice(1).join('/');
    }
    // Otherwise fallback to ID or name
    return model.id;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;

    // Override the requested model with the actual selected candidate model ID
    const upstreamModel = this.getUpstreamModelId(model);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...rest, model: upstreamModel, stream: false } as any);

    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;

    const upstreamModel = this.getUpstreamModelId(model);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...rest, model: upstreamModel, stream: true } as any);
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }
}
