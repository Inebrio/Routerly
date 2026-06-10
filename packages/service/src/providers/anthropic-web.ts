import { randomUUID } from 'node:crypto';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';

/**
 * Unofficial adapter for Claude web (claude.ai).
 *
 * Authentication: `model.apiKey` must contain the value of the `sessionKey` cookie
 * (format: `sk-ant-sid01-...`) from a logged-in claude.ai session.
 * To retrieve it: open claude.ai → DevTools (F12) → Application → Cookies → claude.ai
 * → copy the value of the `sessionKey` cookie.
 *
 * ⚠️  This adapter uses an internal, undocumented API that may break at any time.
 *     Using it may violate Anthropic's Terms of Service.
 */
export class AnthropicWebAdapter implements ProviderAdapter {
  /** Cached organization ID — fetched once per adapter instance */
  private cachedOrgId: string | undefined;
  /** Cached conversation ID — reused across requests to avoid per-request creation */
  private cachedConvId: string | undefined;

  private getSessionKey(model: ModelConfig): string {
    if (!model.apiKey) {
      throw new Error(
        'anthropic-web: no session key configured. ' +
        'Open claude.ai → DevTools (F12) → Application → Cookies → claude.ai ' +
        '→ copy the value of the "sessionKey" cookie.',
      );
    }
    return model.apiKey;
  }

  private getUpstreamModelId(model: ModelConfig): string {
    if (model.upstreamModelId) return model.upstreamModelId;
    if (model.id.includes('/')) return model.id.split('/').slice(1).join('/');
    return model.id;
  }

  private baseUrl(model: ModelConfig): string {
    return model.endpoint?.replace(/\/$/, '') || 'https://claude.ai';
  }

  /** Build browser-like headers to reduce bot-detection false positives. */
  private buildBrowserHeaders(
    sessionKey: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'Origin': 'https://claude.ai',
      'Referer': 'https://claude.ai/',
      'Cookie': `sessionKey=${sessionKey}`,
      ...extra,
    };
  }

  /** Step 1: fetch the organization ID for this session (cached after first call) */
  private async getOrgId(sessionKey: string, base: string): Promise<string> {
    if (this.cachedOrgId) return this.cachedOrgId;

    const response = await globalThis.fetch(`${base}/api/organizations`, {
      headers: this.buildBrowserHeaders(sessionKey),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `anthropic-web: failed to fetch organizations — HTTP ${response.status} ${response.statusText}. ` +
        `Check that your sessionKey is valid.${detail ? ` — ${detail}` : ''}`,
      );
    }

    const orgs = await response.json() as Array<{ uuid: string }>;
    if (!Array.isArray(orgs) || orgs.length === 0) {
      throw new Error('anthropic-web: no organizations found for this session.');
    }

    this.cachedOrgId = orgs[0]!.uuid;
    return this.cachedOrgId;
  }

  /** Step 2: get or create a conversation ID (cached per adapter instance) */
  private async getConvId(sessionKey: string, base: string, orgId: string): Promise<string> {
    if (this.cachedConvId) return this.cachedConvId;
    const response = await globalThis.fetch(
      `${base}/api/organizations/${orgId}/chat_conversations`,
      {
        method: 'POST',
        headers: this.buildBrowserHeaders(sessionKey, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: '' }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `anthropic-web: failed to create conversation — HTTP ${response.status} ${response.statusText}` +
        `${detail ? ` — ${detail}` : ''}`,
      );
    }

    const conv = await response.json() as { uuid: string };
    this.cachedConvId = conv.uuid;
    return this.cachedConvId;
  }

  /** Convert OpenAI-format messages to a single prompt string for the web API */
  private buildPrompt(request: ChatCompletionRequest): string {
    return request.messages
      .map(m => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (m.role === 'system') return content;
        const prefix = m.role === 'assistant' ? 'Assistant' : 'Human';
        return `${prefix}: ${content}`;
      })
      .join('\n\n');
  }

  /**
   * Parse an SSE stream from Claude web and yield text deltas.
   * Claude web emits events like `data: {"type":"completion","completion":" Hello","model":"..."}`.
   */
  private async *parseSSE(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<{ delta: string; model: string; done: boolean }> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            yield { delta: '', model: '', done: true };
            return;
          }
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }
          const type = parsed['type'] as string | undefined;
          if (type === 'completion') {
            const delta = (parsed['completion'] as string | undefined) ?? '';
            const modelStr = (parsed['model'] as string | undefined) ?? '';
            if (delta) yield { delta, model: modelStr, done: false };
          } else if (type === 'message_stop') {
            yield { delta: '', model: '', done: true };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Step 3: send the completion request and return the raw fetch Response */
  private async sendCompletion(
    sessionKey: string,
    base: string,
    orgId: string,
    convId: string,
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<Response> {
    const upstreamModel = this.getUpstreamModelId(model);
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: upstreamModel,
      prompt: this.buildPrompt({ ...request, messages: nonSystemMessages }),
      timezone: 'UTC',
      attachments: [],
      files: [],
    };
    if (systemMessage?.content) {
      body['system_prompt'] = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content);
    }

    const response = await globalThis.fetch(
      `${base}/api/organizations/${orgId}/chat_conversations/${convId}/completion`,
      {
        method: 'POST',
        headers: this.buildBrowserHeaders(sessionKey, {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        }),
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      // 404 means the conversation was deleted/expired — invalidate cache so next call creates a fresh one
      if (response.status === 404) this.cachedConvId = undefined;
      const retryAfter = response.headers.get('Retry-After');
      const detail = await response.text().catch(() => '');
      throw new Error(
        `anthropic-web: completion request failed — HTTP ${response.status} ${response.statusText}` +
        `${retryAfter ? ` (retry after ${retryAfter}s)` : ''}` +
        `${detail ? ` — ${detail}` : ''}`,
      );
    }
    return response;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const sessionKey = this.getSessionKey(model);
    const base = this.baseUrl(model);

    const orgId = await this.getOrgId(sessionKey, base);
    const convId = await this.getConvId(sessionKey, base, orgId);
    const response = await this.sendCompletion(sessionKey, base, orgId, convId, request, model);

    if (!response.body) throw new Error('anthropic-web: empty response body');

    let finalText = '';
    let finalModel = this.getUpstreamModelId(model);

    for await (const chunk of this.parseSSE(response.body)) {
      if (chunk.done) break;
      finalText += chunk.delta;
      if (chunk.model) finalModel = chunk.model;
    }

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    return {
      id,
      object: 'chat.completion',
      created,
      model: finalModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: finalText },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const sessionKey = this.getSessionKey(model);
    const base = this.baseUrl(model);

    const orgId = await this.getOrgId(sessionKey, base);
    const convId = await this.getConvId(sessionKey, base, orgId);
    const response = await this.sendCompletion(sessionKey, base, orgId, convId, request, model);

    if (!response.body) throw new Error('anthropic-web: empty response body');

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    let finalModel = this.getUpstreamModelId(model);

    for await (const chunk of this.parseSSE(response.body)) {
      if (chunk.done) break;
      if (chunk.model) finalModel = chunk.model;
      if (chunk.delta) {
        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: finalModel,
          choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null }],
        };
      }
    }

    yield {
      id,
      object: 'chat.completion.chunk',
      created,
      model: finalModel,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
  }
}
