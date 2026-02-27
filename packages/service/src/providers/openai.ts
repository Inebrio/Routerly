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
    });
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
