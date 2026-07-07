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

/**
 * Gemini returns API errors wrapped in a JSON array — `[{ "error": {...} }]` —
 * whereas the OpenAI SDK expects `{ "error": {...} }` and reads `.error` off the
 * root. On an array body the SDK finds nothing and reports the useless
 * `"<status> status code (no body)"`, hiding the real cause (quota, billing,
 * bad key, …). Unwrap the array on non-2xx responses so the SDK surfaces
 * Google's actual message. Success responses (incl. streams) pass through
 * untouched so their body is never consumed.
 */
export const unwrapGeminiError: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input as Parameters<typeof fetch>[0], init);
  if (res.ok) return res;
  const text = await res.text();
  let body = text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
      body = JSON.stringify(parsed[0]);
    }
  } catch {
    // Non-JSON error body — forward as-is.
  }
  const headers = new Headers(res.headers);
  headers.delete('content-length'); // body length changed
  headers.delete('content-encoding'); // text() already decoded
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
};

/**
 * Google Gemini adapter using the OpenAI-compatible endpoint.
 * Gemini supports an OpenAI-compatible API at:
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 */
export class GeminiAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const apiKey = model.apiKey ?? '';
    const baseURL =
      model.endpoint || 'https://generativelanguage.googleapis.com/v1beta/openai/';
    // Cast: the SDK's Fetch type accepts a broader `input` than the DOM fetch.
    const fetchOverride = unwrapGeminiError as unknown as NonNullable<ConstructorParameters<typeof OpenAI>[0]>['fetch'];
    return new OpenAI({ apiKey, baseURL, fetch: fetchOverride });
  }

  private getUpstreamModelId(model: ModelConfig): string {
    if (model.id.includes('/')) return model.id.split('/').slice(1).join('/');
    return model.id;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...rest, model: this.getUpstreamModelId(model), stream: false } as any);
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...rest, model: this.getUpstreamModelId(model), stream: true } as any);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.chat.completions.create({
      messages: openAIMessages,
      model: upstreamModel,
      max_tokens: request.max_tokens,
      stream: false,
    } as any);
    return openAIToAnthropicResponse(response, upstreamModel);
  }
}
