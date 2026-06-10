import { createHash, randomUUID } from 'node:crypto';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';

/**
 * Unofficial adapter for ChatGPT web (chatgpt.com).
 *
 * Authentication:
 *   - `model.apiKey` — the `accessToken` JWT from https://chatgpt.com/api/auth/session
 *   - `model.cfClearance` — the `cf_clearance` cookie (DevTools → Application → Cookies)
 *
 * ⚠️  This adapter uses an internal, undocumented API that may break at any time.
 *     Using it may violate OpenAI's Terms of Service.
 */
export class OpenAIWebAdapter implements ProviderAdapter {
  private getAccessToken(model: ModelConfig): string {
    const token = model.apiKey ?? '';
    if (!token) {
      throw new Error(
        'openai-web: no access token configured. ' +
        'Visit https://chatgpt.com/api/auth/session while logged in and copy the "accessToken" field.',
      );
    }
    return token;
  }

  /**
   * Build browser-like headers to satisfy Cloudflare bot detection.
   * Include the cf_clearance cookie when provided.
   */
  private buildBrowserHeaders(
    token: string,
    cfClearance: string | undefined,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://chatgpt.com',
      'Referer': 'https://chatgpt.com/',
      ...extra,
    };
    if (cfClearance) {
      headers['Cookie'] = `cf_clearance=${cfClearance}`;
    }
    return headers;
  }

  private getUpstreamModelId(model: ModelConfig): string {
    if (model.upstreamModelId) return model.upstreamModelId;
    if (model.id.includes('/')) return model.id.split('/').slice(1).join('/');
    return model.id;
  }

  /**
   * Compute a proof-of-work token required by chatgpt.com's sentinel system.
   * Mirrors the algorithm from the official ChatGPT web client.
   */
  private generateProofToken(seed: string, difficulty: string): string {
    const screens = [3008, 4010, 6000];
    const multipliers = [1, 2, 4];
    const screen =
      screens[Math.floor(Math.random() * screens.length)]! *
      multipliers[Math.floor(Math.random() * multipliers.length)]!;
    const parseTime = new Date().toUTCString();
    const reactKeys = [
      '_reactListeningcfilawjnerp',
      '_reactListening9ne2dfo1i47',
      '_reactListening410nzwhan2a',
    ];
    const windowKeys = ['alert', 'ontransitionend', 'onprogress'];
    const proof: unknown[] = [
      screen,
      parseTime,
      null,
      0, // nonce — updated in loop
      null,
      'https://tcr9i.chat.openai.com/v2/35536E1E-65B4-4D96-9D97-6ADB7EFF8147/api.js',
      'dpl=1440a687921de39ff5ee56b92807faaadce73f13',
      'en',
      'en-US',
      null,
      'plugins\u2212[object PluginArray]',
      reactKeys[Math.floor(Math.random() * reactKeys.length)],
      windowKeys[Math.floor(Math.random() * windowKeys.length)],
    ];

    const diffLen = difficulty.length;
    for (let i = 0; i < 100000; i++) {
      proof[3] = i;
      const base = Buffer.from(JSON.stringify(proof)).toString('base64');
      const hash = createHash('sha3-512').update(seed + base).digest('hex');
      if (hash.slice(0, diffLen) <= difficulty) {
        return 'gAAAAAB' + base;
      }
    }

    // Fallback if no nonce found within budget
    const fallback = Buffer.from(`"${seed}"`).toString('base64');
    return 'gAAAAABwQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D' + fallback;
  }

  /**
   * Fetch sentinel chat-requirements and return the required headers.
   * Returns an empty object on any failure so callers degrade gracefully.
   */
  private async getSentinelHeaders(
    token: string,
    baseUrl: string,
    cfClearance: string | undefined,
  ): Promise<Record<string, string>> {
    try {
      const response = await globalThis.fetch(
        `${baseUrl}/backend-api/sentinel/chat-requirements`,
        {
          headers: this.buildBrowserHeaders(token, cfClearance),
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        process.stderr.write(`openai-web sentinel: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}\n`);
        return {};
      }
      const data = await response.json() as {
        token?: string;
        proofofwork?: { required: boolean; seed: string; difficulty: string };
      };
      if (!data.token) return {};
      const headers: Record<string, string> = {
        'Openai-Sentinel-Chat-Requirements-Token': data.token,
      };
      if (data.proofofwork?.required) {
        headers['Openai-Sentinel-Proof-Token'] = this.generateProofToken(
          data.proofofwork.seed,
          data.proofofwork.difficulty,
        );
      }
      return headers;
    } catch {
      return {};
    }
  }

  /** Convert OpenAI-format messages to ChatGPT internal format */
  private buildMessages(request: ChatCompletionRequest): Array<{
    id: string;
    author: { role: string };
    content: { content_type: string; parts: string[] };
  }> {
    return request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        id: randomUUID(),
        author: { role: m.role === 'assistant' ? 'assistant' : 'user' },
        content: {
          content_type: 'text',
          parts: [typeof m.content === 'string' ? m.content : JSON.stringify(m.content)],
        },
      }));
  }

  private buildBody(request: ChatCompletionRequest, model: ModelConfig): Record<string, unknown> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const body: Record<string, unknown> = {
      action: 'next',
      messages: this.buildMessages(request),
      model: this.getUpstreamModelId(model),
      parent_message_id: randomUUID(),
      timezone_offset_min: 0,
    };
    if (systemMessage?.content) {
      body.system_prompt = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content);
    }
    return body;
  }

  /**
   * Parse an SSE stream from ChatGPT backend and accumulate the final text.
   * Returns the accumulated text and the model string reported by the API.
   */
  /**
   * Strip or convert ChatGPT-internal widget annotations embedded in text.
   * Annotations are delimited by U+1F523 (🔣): 🔣{...}🔣
   *  - math_block_widget_*  → $$…$$
   *  - math_inline_widget_* → $…$
   *  - all others           → removed
   */
  private static cleanAnnotations(raw: string): string {
    const MARKER = '\u{1F523}'; // 🔣  (length === 2 in JS UTF-16)
    let result = raw;
    let idx = 0;
    for (;;) {
      const start = result.indexOf(MARKER, idx);
      if (start === -1) break;
      const jsonStart = start + MARKER.length;
      if (result[jsonStart] !== '{') { idx = start + 1; continue; }
      // Walk to matching closing brace
      let depth = 0;
      let pos = jsonStart;
      while (pos < result.length) {
        if (result[pos] === '{') depth++;
        else if (result[pos] === '}') { depth--; if (depth === 0) break; }
        pos++;
      }
      if (depth !== 0) { idx = start + 1; continue; }
      const jsonEnd = pos + 1;
      if (result.slice(jsonEnd, jsonEnd + MARKER.length) !== MARKER) { idx = start + 1; continue; }
      const end = jsonEnd + MARKER.length;

      let replacement = '';
      try {
        const ann = JSON.parse(result.slice(jsonStart, jsonEnd)) as Record<string, unknown>;
        const key = Object.keys(ann)[0] ?? '';
        const inner = ann[key] as Record<string, string> | undefined;
        const content = inner?.['content'] ?? '';
        if (key.startsWith('math_block_widget')) {
          replacement = `\n$$\n${content}\n$$\n`;
        } else if (key.startsWith('math_inline_widget')) {
          replacement = `$${content}$`;
        }
        // all other annotations → silently drop
      } catch {
        // unparseable → drop
      }
      result = result.slice(0, start) + replacement + result.slice(end);
      idx = start + replacement.length;
    }
    return result;
  }

  private async *parseSSE(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<{ text: string; model: string; done: boolean }> {
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
            yield { text: '', model: '', done: true };
            return;
          }
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }
          const message = parsed['message'] as Record<string, unknown> | undefined;
          if (!message) continue;
          const status = message['status'] as string | undefined;
          if (status !== 'in_progress' && status !== 'finished_successfully') continue;
          const content = message['content'] as Record<string, unknown> | undefined;
          const parts = content?.['parts'] as unknown[] | undefined;
          if (!Array.isArray(parts)) continue;
          const text = OpenAIWebAdapter.cleanAnnotations(
            parts.filter(p => typeof p === 'string').join(''),
          );
          const metadata = message['metadata'] as Record<string, unknown> | undefined;
          const modelSlug = (metadata?.['model_slug'] as string | undefined) ?? '';
          yield { text, model: modelSlug, done: false };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const token = this.getAccessToken(model);
    const cfClearance = model.cfClearance;
    const baseUrl = model.endpoint || 'https://chatgpt.com';
    const endpoint = baseUrl + '/backend-api/conversation';

    const sentinelHeaders = await this.getSentinelHeaders(token, baseUrl, cfClearance);

    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: this.buildBrowserHeaders(token, cfClearance, {
        ...sentinelHeaders,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      }),
      body: JSON.stringify(this.buildBody(request, model)),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`openai-web: HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
    }
    if (!response.body) {
      throw new Error('openai-web: empty response body');
    }

    let finalText = '';
    let finalModel = this.getUpstreamModelId(model);

    for await (const chunk of this.parseSSE(response.body)) {
      if (chunk.done) break;
      finalText = chunk.text;
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
    const token = this.getAccessToken(model);
    const cfClearance = model.cfClearance;
    const baseUrl = model.endpoint || 'https://chatgpt.com';
    const endpoint = baseUrl + '/backend-api/conversation';

    const sentinelHeaders = await this.getSentinelHeaders(token, baseUrl, cfClearance);

    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: this.buildBrowserHeaders(token, cfClearance, {
        ...sentinelHeaders,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      }),
      body: JSON.stringify(this.buildBody(request, model)),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`openai-web: HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
    }
    if (!response.body) {
      throw new Error('openai-web: empty response body');
    }

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    let prevText = '';
    let finalModel = this.getUpstreamModelId(model);

    for await (const chunk of this.parseSSE(response.body)) {
      if (chunk.done) break;
      if (chunk.model) finalModel = chunk.model;
      // Emit only the delta (new characters since last chunk)
      const delta = chunk.text.slice(prevText.length);
      prevText = chunk.text;
      if (delta) {
        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: finalModel,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        };
      }
    }

    // Final chunk with finish_reason
    yield {
      id,
      object: 'chat.completion.chunk',
      created,
      model: finalModel,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
  }
}
