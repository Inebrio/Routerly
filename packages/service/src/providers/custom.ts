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
 * Generic adapter for any provider that exposes an OpenAI-compatible API.
 * Requires a custom endpoint in ModelConfig.
 *
 * chatCompletion and streamCompletion use raw fetch to guarantee 100%
 * wire-format transparency — the OpenAI SDK may normalize/strip non-standard
 * fields (e.g. DeepSeek reasoning_content) before sending.
 */
export class CustomAdapter implements ProviderAdapter {
  // Resolve the model identifier to send to the upstream API.
  // Prefers the explicit upstreamModelId field; falls back to stripping the provider prefix.
  // e.g. upstreamModelId="deepseek-reasoner" → "deepseek-reasoner"
  // e.g. id="deepseek/deepseek-r1" (no upstreamModelId) → "deepseek-r1"
  private getUpstreamModelId(model: ModelConfig): string {
    if (model.upstreamModelId) return model.upstreamModelId;
    if (model.id.includes('/')) {
      return model.id.split('/').slice(1).join('/');
    }
    return model.id;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    if (!model.endpoint) {
      throw new Error(`Custom provider model "${model.id}" has no endpoint configured.`);
    }
    const upstreamModel = this.getUpstreamModelId(model);
    const { stream: _stream, ...rest } = request;
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey ?? 'custom'}`,
      },
      body: JSON.stringify({ ...rest, model: upstreamModel, stream: false }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Custom provider returned ${response.status}: ${text}`);
    }
    return response.json() as Promise<ChatCompletionResponse>;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    if (!model.endpoint) {
      throw new Error(`Custom provider model "${model.id}" has no endpoint configured.`);
    }
    const upstreamModel = this.getUpstreamModelId(model);
    const { stream: _stream, ...rest } = request;
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey ?? 'custom'}`,
      },
      body: JSON.stringify({ ...rest, model: upstreamModel, stream: true }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Custom provider returned ${response.status}: ${text}`);
    }
    if (!response.body) {
      throw new Error('Custom provider returned no response body for streaming.');
    }
    // Parse SSE frames from the response body.
    const decoder = new TextDecoder();
    let buf = '';
    for await (const raw of response.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(raw, { stream: true });
      const lines = buf.split('\n');
      // split() always returns ≥1 element so pop() never returns undefined.
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data) as StreamChunk;
        } catch {
          // Skip malformed SSE frames.
        }
      }
    }
    // Flush any remaining buffer content.
    if (buf.startsWith('data: ')) {
      const data = buf.slice(6).trim();
      if (data && data !== '[DONE]') {
        try { yield JSON.parse(data) as StreamChunk; } catch { /* skip */ }
      }
    }
  }

  async messages(request: MessagesRequest, model: ModelConfig): Promise<MessagesResponse> {
    // ponytail: messages() uses the SDK — it converts Anthropic→OpenAI format anyway,
    // so SDK normalization is harmless here; reasoning_content issue is OpenAI-format only.
    if (!model.endpoint) {
      throw new Error(`Custom provider model "${model.id}" has no endpoint configured.`);
    }
    const client = new OpenAI({ apiKey: model.apiKey ?? 'custom', baseURL: model.endpoint });
    const upstreamModel = this.getUpstreamModelId(model);
    const { messages, system } = anthropicToOpenAIMessages(request);
    const openAIMessages = system
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages;
    const { stream: _stream, ...rest } = request as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.chat.completions.create({
      ...rest,
      messages: openAIMessages,
      model: upstreamModel,
      stream: false,
    } as any);
    return openAIToAnthropicResponse(response, upstreamModel);
  }
}
