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
      baseURL: model.endpoint || 'https://api.anthropic.com',
      timeout: 10000, // 10s timeout to prevent routing deadlocks
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
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const userMessages = request.messages.filter((m) => m.role !== 'system');

    const params: any = {
      model: upstreamModel,
      max_tokens: request.max_tokens ?? 4096,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      stream: true,
    };
    if (systemMessage?.content && typeof systemMessage.content === 'string') {
      params.system = systemMessage.content;
    }

    // Extended thinking — requires min 16k max_tokens per Anthropic spec
    const thinkingEnabled = model.capabilities?.thinking === true;
    if (thinkingEnabled) {
      params.thinking = { type: 'enabled', budget_tokens: 10000 };
      if ((params.max_tokens as number) < 16000) params.max_tokens = 16000;
    }

    const stream = await client.messages.create(params) as unknown as AsyncIterable<any>;

    let id = `chatcmpl-${Math.random().toString(36).substring(2, 10)}`;
    const created = Math.floor(Date.now() / 1000);
    const responseModel = upstreamModel;
    let inputTokens = 0;

    // Track which content block index is which type (thinking vs text)
    const blockTypes = new Map<number, 'thinking' | 'text'>();

    for await (const event of stream) {
      if (event.type === 'message_start') {
        id = event.message.id;
        inputTokens = event.message.usage.input_tokens;
        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: responseModel,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: null,
            },
          ],
        } as unknown as StreamChunk;
      } else if (event.type === 'content_block_start') {
        // Register block type so we know how to handle its deltas
        blockTypes.set(event.index as number, event.content_block?.type === 'thinking' ? 'thinking' : 'text');
      } else if (event.type === 'content_block_delta') {
        const blockType = blockTypes.get(event.index as number) ?? 'text';

        if (blockType === 'thinking' && event.delta.type === 'thinking_delta') {
          // Thinking chunk — use custom field `thinking` on the delta
          yield {
            id,
            object: 'chat.completion.chunk',
            created,
            model: responseModel,
            choices: [
              {
                index: 0,
                delta: { thinking: event.delta.thinking } as any,
                finish_reason: null,
              },
            ],
          } as unknown as StreamChunk;
        } else if (blockType === 'text' && event.delta.type === 'text_delta') {
          yield {
            id,
            object: 'chat.completion.chunk',
            created,
            model: responseModel,
            choices: [
              {
                index: 0,
                delta: { content: event.delta.text },
                finish_reason: null,
              },
            ],
          } as unknown as StreamChunk;
        }
      } else if (event.type === 'message_delta') {
        const outputTokens = event.usage?.output_tokens ?? 0;
        let finish_reason = null;
        if (event.delta.stop_reason === 'end_turn') finish_reason = 'stop';
        else if (event.delta.stop_reason === 'max_tokens') finish_reason = 'length';
        else if (event.delta.stop_reason === 'stop_sequence') finish_reason = 'stop';

        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: responseModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason,
            },
          ],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        } as unknown as StreamChunk;
      }
    }
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
