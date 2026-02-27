import Anthropic from '@anthropic-ai/sdk';
import { decrypt } from '@localrouter/shared';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
  MessagesRequest,
  MessagesResponse,
} from '@localrouter/shared';
import type { ProviderAdapter } from './types.js';

export class AnthropicAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): Anthropic {
    const apiKey = model.encryptedApiKey ? decrypt(model.encryptedApiKey) : '';
    return new Anthropic({
      apiKey,
      baseURL: model.endpoint !== 'https://api.anthropic.com' ? model.endpoint : undefined,
    });
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);

    // Convert OpenAI message format to Anthropic format
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const userMessages = request.messages.filter((m) => m.role !== 'system');

    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    });

    // Convert Anthropic response to OpenAI format
    const textContent = response.content.find((b) => b.type === 'text');
    return {
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent?.type === 'text' ? textContent.text : '',
          },
          finish_reason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async *streamCompletion(
    _request: ChatCompletionRequest,
    _model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    // TODO: implement Anthropic streaming
    throw new Error('Anthropic streaming not yet implemented');
  }

  async messages(request: MessagesRequest, model: ModelConfig): Promise<MessagesResponse> {
    const client = this.getClient(model);

    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      stream: false,
    });

    return response as unknown as MessagesResponse;
  }
}
