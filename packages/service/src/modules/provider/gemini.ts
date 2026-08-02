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
 * Documented placeholder for function calls the API did not generate itself.
 * Gemini 3 rejects a replayed tool call whose `thought_signature` is missing:
 *   400 INVALID_ARGUMENT — "Function call is missing a thought_signature in
 *   functionCall parts."
 * Routerly always hits that case: the signature travels in Google's
 * `extra_content`, which has no place in the Anthropic wire format, so the
 * client (Claude Code) sends the tool_use back without it.
 * See https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
 */
const THOUGHT_SIGNATURE_PLACEHOLDER = 'skip_thought_signature_validator';

/**
 * Stamp the placeholder signature on every assistant tool call that lacks one,
 * so a multi-turn tool conversation survives the round trip through Routerly.
 *
 * ponytail: the placeholder costs reasoning quality (Google's own warning). The
 * upgrade path is caching the real `extra_content.google.thought_signature` by
 * tool-call id on the way out and re-attaching it here — worth doing only if
 * tool-heavy Gemini sessions measurably degrade.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withThoughtSignatures(messages: any[]): any[] {
  return messages.map((m) => {
    if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls) || m.tool_calls.length === 0) return m;
    return {
      ...m,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool_calls: m.tool_calls.map((call: any) =>
        call?.extra_content?.google?.thought_signature
          ? call
          : { ...call, extra_content: { google: { thought_signature: THOUGHT_SIGNATURE_PLACEHOLDER } } },
      ),
    };
  });
}

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
    const response = await client.chat.completions.create({ ...rest, messages: withThoughtSignatures(rest.messages), model: this.getUpstreamModelId(model), stream: false } as any);
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...rest, messages: withThoughtSignatures(rest.messages), model: this.getUpstreamModelId(model), stream: true } as any);
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
      messages: withThoughtSignatures(openAIMessages),
      model: upstreamModel,
      max_tokens: request.max_tokens,
      stream: false,
    } as any);
    return openAIToAnthropicResponse(response, upstreamModel);
  }
}
