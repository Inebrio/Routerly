import OpenAI from 'openai';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
  MessagesRequest,
  MessagesResponse,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';
import { anthropicToOpenAIMessages, openAIToAnthropicResponse } from './messages-compat.js';

export class OpenAIAdapter implements ProviderAdapter {
  protected getClient(model: ModelConfig): OpenAI {
    const apiKey = model.apiKey ?? '';
    return new OpenAI({
      apiKey,
      baseURL: model.endpoint || 'https://api.openai.com/v1',
      timeout: model.timeout ?? 60000,
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

  // Normalize max_tokens → max_completion_tokens.
  // Newer OpenAI models (o1, o3, o4-mini, gpt-4.5, …) reject max_tokens with a 400.
  private normalizeTokenLimit(req: ChatCompletionRequest): Omit<ChatCompletionRequest, 'max_tokens'> {
    const { max_tokens, max_completion_tokens, ...rest } = req;
    const resolved = max_completion_tokens ?? max_tokens;
    return resolved != null ? { ...rest, max_completion_tokens: resolved } : rest;
  }

  // o-series models (o1, o3, o4-mini, …) support reasoning_effort; GPT-family models do not.
  private isReasoningModel(modelId: string): boolean {
    return /^o\d/.test(modelId);
  }

  // Strip reasoning-model-only params when forwarding to non-o-series models.
  private normalizeForModel(req: ChatCompletionRequest, upstreamModel: string): Record<string, unknown> {
    const { stream: _stream, input: _input, ...normalized } = this.normalizeTokenLimit(req) as Record<string, unknown>;
    if (!this.isReasoningModel(upstreamModel)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { reasoning_effort, reasoning_summary, ...safe } = normalized;
      return safe;
    }
    return normalized;
  }

  /**
   * Some default-reasoning chat models (the gpt-5.x family) reject any request that mixes
   * function tools with reasoning on /v1/chat/completions — even when `reasoning_effort` was
   * never set, since the model still reasons by default unless told `'none'`. Detected by
   * OpenAI's own error rather than a hardcoded model list, since the affected model set has
   * changed release to release and will keep changing.
   */
  private isReasoningToolsConflict(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const message = (err as { message?: string })?.message ?? '';
    return status === 400 && /reasoning_effort/i.test(message) && /function tools|tool/i.test(message);
  }

  /**
   * Call `chat.completions.create`, retrying once with `reasoning_effort: 'none'` forced on
   * if the provider rejects the request as a tools+reasoning conflict (see isReasoningToolsConflict).
   * A drop-in client shouldn't have to know about this quirk — Routerly keeps the call working
   * without the client ever seeing the 400.
   */
  private async createChatCompletion(
    client: OpenAI,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await client.chat.completions.create(body as never);
    } catch (err) {
      if (!this.isReasoningToolsConflict(err)) throw err;
      return await client.chat.completions.create({ ...body, reasoning_effort: 'none' } as never);
    }
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);

    // Override the requested model with the actual selected candidate model ID
    const upstreamModel = this.getUpstreamModelId(model);
    const rest = this.normalizeForModel(request, upstreamModel);

    const response = await this.createChatCompletion(client, { ...rest, model: upstreamModel, stream: false });

    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);
    const rest = this.normalizeForModel(request, upstreamModel);

    const stream = (await this.createChatCompletion(client, { ...rest, model: upstreamModel, stream: true })) as AsyncIterable<unknown>;
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }

  async messages(request: MessagesRequest, model: ModelConfig): Promise<MessagesResponse> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);
    const { messages, system } = anthropicToOpenAIMessages(request);
    const openAIMessages = system
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages;
    const normalized = this.normalizeForModel(
      { messages: openAIMessages, max_tokens: request.max_tokens } as unknown as ChatCompletionRequest,
      upstreamModel,
    );
    const response = await this.createChatCompletion(client, {
      ...normalized,
      model: upstreamModel,
      stream: false,
    });
    return openAIToAnthropicResponse(response as never, upstreamModel);
  }
}
