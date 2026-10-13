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
import { forwardableResponseHeaders, type CallOptions } from './passthrough.js';
import { anthropicToOpenAIMessages, openAIToAnthropicResponse } from './messages-compat.js';

export class OpenAIAdapter implements ProviderAdapter {
  protected getClient(model: ModelConfig): OpenAI {
    const apiKey = model.apiKey ?? '';
    return new OpenAI({
      apiKey,
      baseURL: model.endpoint || 'https://api.openai.com/v1',
      timeout: model.timeout ?? 60000,
      maxRetries: 0, // retry/failover is Routerly's job (resilience + candidate loop); SDK retries multiplied the timeout x3
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

  // Only models that reject max_tokens (o-series, gpt-5) get max_completion_tokens;
  // every other model receives the client's body untouched (wire transparency).
  private requiresCompletionTokens(modelId: string): boolean {
    return /^(o\d|gpt-5)/.test(modelId);
  }

  private normalizeTokenLimit(req: ChatCompletionRequest, upstreamModel: string): Omit<ChatCompletionRequest, 'max_tokens'> | ChatCompletionRequest {
    if (!this.requiresCompletionTokens(upstreamModel)) return req;
    const { max_tokens, max_completion_tokens, ...rest } = req;
    const resolved = max_completion_tokens ?? max_tokens;
    return resolved != null ? { ...rest, max_completion_tokens: resolved } : rest;
  }

  // Strip the SDK's identity headers so only the client's own reach the provider.
  private static readonly SDK_HEADERS = [
    'user-agent', 'x-stainless-lang', 'x-stainless-package-version', 'x-stainless-os',
    'x-stainless-arch', 'x-stainless-runtime', 'x-stainless-runtime-version',
    'x-stainless-retry-count', 'x-stainless-timeout',
  ];

  protected requestOptions(opts?: CallOptions): { headers: Record<string, string | null> } {
    const headers: Record<string, string | null> = Object.fromEntries(OpenAIAdapter.SDK_HEADERS.map((h) => [h, null]));
    return { headers: { ...headers, ...opts?.headers } };
  }

  // o-series models (o1, o3, o4-mini, …) support reasoning_effort; GPT-family models do not.
  private isReasoningModel(modelId: string): boolean {
    return /^o\d/.test(modelId);
  }

  // Strip reasoning-model-only params when forwarding to non-o-series models.
  private normalizeForModel(req: ChatCompletionRequest, upstreamModel: string): Record<string, unknown> {
    const { input: _input, ...normalized } = this.normalizeTokenLimit(req, upstreamModel) as Record<string, unknown>;
    if (!this.isReasoningModel(upstreamModel)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { reasoning_effort, reasoning_summary, ...safe } = normalized;
      return safe;
    }
    return normalized;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
    opts?: CallOptions,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);

    // Override the requested model with the actual selected candidate model ID
    const upstreamModel = this.getUpstreamModelId(model);
    const rest = this.normalizeForModel(request, upstreamModel);

    // `stream` is forwarded exactly as the client sent it (absent stays absent).
    const { stream: _s, ...body } = rest;
    const sent = request.stream === false ? { ...body, stream: false } : body;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, response } = await (client.chat.completions.create({ ...sent, model: upstreamModel } as any, this.requestOptions(opts)) as any).withResponse();
    opts?.onResponseHeaders?.(forwardableResponseHeaders(response.headers));

    return data as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
    opts?: CallOptions,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);
    const rest = this.normalizeForModel(request, upstreamModel);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stream, response } = await (client.chat.completions.create({ ...rest, model: upstreamModel, stream: true } as any, this.requestOptions(opts)) as any).withResponse();
    opts?.onResponseHeaders?.(forwardableResponseHeaders(response.headers));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.chat.completions.create({
      ...normalized,
      model: upstreamModel,
      stream: false,
    } as any);
    return openAIToAnthropicResponse(response, upstreamModel);
  }
}
