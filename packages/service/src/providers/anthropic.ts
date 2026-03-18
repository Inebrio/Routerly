import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
  MessagesRequest,
  MessagesResponse,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';

export class AnthropicAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): Anthropic {
    const apiKey = model.apiKey ?? '';
    return new Anthropic({
      apiKey,
      baseURL: model.endpoint || 'https://api.anthropic.com',
      timeout: model.timeout ?? 60000,
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

  /**
   * Converts an OpenAI-format message array to Anthropic-compatible messages.
   *
   * Key differences:
   *  - role:'tool'  → role:'user' with [{type:'tool_result', tool_use_id, content}]
   *  - role:'assistant' with tool_calls → content blocks of type 'tool_use'
   *  - Consecutive tool_result blocks are merged into a single user message (Anthropic requirement)
   *  - Array content (content parts) is mapped block-by-block preserving cache_control
   */

  /**
   * Converts an OpenAI content value (string or content-part array) to Anthropic content blocks.
   * Preserves `cache_control` on each block so prompt caching works end-to-end.
   */
  private convertContent(content: string | any[]): string | any[] {
    if (typeof content === 'string') return content;
    return content.map((part) => {
      // cache_control and other extra fields are spread in as-is
      const { type, text, image_url, ...rest } = part as any;
      if (type === 'image_url' && image_url?.url) {
        const url: string = image_url.url;
        if (url.startsWith('data:')) {
          // data URI → base64
          const [header, data] = url.split(',', 2);
          const media_type = (header ?? '').replace('data:', '').replace(';base64', '') as any;
          return { type: 'image', source: { type: 'base64', media_type, data }, ...rest };
        }
        return { type: 'image', source: { type: 'url', url }, ...rest };
      }
      // Default: text block (preserves cache_control and any other extra fields)
      return { type: 'text', text: text ?? '', ...rest };
    });
  }

  /**
   * Converts an OpenAI system message content to Anthropic system format.
   * Supports both plain strings and content-part arrays (for cache_control).
   */
  private convertSystem(content: string | any[]): string | any[] {
    if (typeof content === 'string') return content;
    // Map to Anthropic text blocks, preserving cache_control
    return content.map((part) => {
      const { type: _type, text, ...rest } = part as any;
      return { type: 'text', text: text ?? '', ...rest };
    });
  }

  private convertMessages(messages: import('@routerly/shared').Message[]): any[] {
    const result: any[] = [];

    for (const m of messages) {
      const rawMessage = m as any;

      if (m.role === 'tool') {
        // OpenAI tool result → Anthropic tool_result content block inside a user turn
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        };
        // Merge with preceding user message if it already contains tool_result blocks
        const last = result[result.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(toolResultBlock);
        } else {
          result.push({ role: 'user', content: [toolResultBlock] });
        }
      } else if (m.role === 'assistant' && rawMessage.tool_calls?.length) {
        // OpenAI assistant tool_calls → Anthropic tool_use content blocks
        const content: any[] = [];
        if (m.content) {
          content.push({ type: 'text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        }
        for (const tc of rawMessage.tool_calls) {
          let input: any = {};
          try { input = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /* ignore */ }
          content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name ?? '', input });
        }
        result.push({ role: 'assistant', content });
      } else {
        result.push({
          role: m.role as 'user' | 'assistant',
          content: this.convertContent(m.content as string | any[]),
        });
      }
    }

    return result;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);

    // Convert OpenAI message format to Anthropic format
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

    const upstreamModel = this.getUpstreamModelId(model);

    const params: any = {
      model: upstreamModel,
      max_tokens: request.max_tokens ?? 4096,
      messages: this.convertMessages(nonSystemMessages),
    };
    if (systemMessage?.content) {
      params.system = this.convertSystem(systemMessage.content as string | any[]);
    }

    const response = await client.messages.create(params);

    // Convert Anthropic response to OpenAI format
    const textContent = response.content.find((b) => b.type === 'text');
    const cacheRead = (response.usage as any).cache_read_input_tokens ?? 0;
    const cacheCreation = (response.usage as any).cache_creation_input_tokens ?? 0;
    const totalInputTokens = response.usage.input_tokens + cacheRead + cacheCreation;
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
        prompt_tokens: totalInputTokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: totalInputTokens + response.usage.output_tokens,
        ...(cacheRead > 0 || cacheCreation > 0 ? {
          prompt_tokens_details: {
            ...(cacheRead > 0 ? { cached_tokens: cacheRead } : {}),
            ...(cacheCreation > 0 ? { cache_creation_tokens: cacheCreation } : {}),
          }
        } : {}),
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
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

    const params: any = {
      model: upstreamModel,
      max_tokens: request.max_tokens ?? 4096,
      messages: this.convertMessages(nonSystemMessages),
      stream: true,
    };
    if (systemMessage?.content) {
      params.system = this.convertSystem(systemMessage.content as string | any[]);
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
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    // Track which content block index is which type (thinking vs text)
    const blockTypes = new Map<number, 'thinking' | 'text'>();

    for await (const event of stream) {
      if (event.type === 'message_start') {
        id = event.message.id;
        inputTokens = event.message.usage.input_tokens;
        cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
        cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0;
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
        const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
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
            prompt_tokens: totalInputTokens,
            completion_tokens: outputTokens,
            total_tokens: totalInputTokens + outputTokens,
            ...(cacheReadTokens > 0 || cacheCreationTokens > 0 ? {
              prompt_tokens_details: {
                ...(cacheReadTokens > 0 ? { cached_tokens: cacheReadTokens } : {}),
                ...(cacheCreationTokens > 0 ? { cache_creation_tokens: cacheCreationTokens } : {}),
              }
            } : {}),
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
