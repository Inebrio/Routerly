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

  // Helper to extract the actual upstream model string
  private getUpstreamModelId(model: ModelConfig): string {
    // If the ID contains a slash (e.g., 'anthropic/claude-opus'), take the part after the slash
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

    // Convert OpenAI message format to Anthropic format
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const userMessages = request.messages.filter((m) => m.role !== 'system');

    const upstreamModel = this.getUpstreamModelId(model);

    const params: any = {
      model: upstreamModel,
      max_tokens: request.max_tokens ?? 4096,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };
    if (systemMessage?.content && typeof systemMessage.content === 'string') {
      params.system = systemMessage.content;
    }

    const response = await client.messages.create(params);

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
    const upstreamModel = this.getUpstreamModelId(model);

    const params: any = {
      model: upstreamModel,
      max_tokens: request.max_tokens,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      stream: false,
    };
    if (request.system) {
      params.system = request.system;
    }

    const response = await client.messages.create(params);

    return response as unknown as MessagesResponse;
  }
}
