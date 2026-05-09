import { randomUUID } from 'node:crypto';
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
 * Authentication: `model.apiKey` must contain the `accessToken` JWT obtained from
 * https://chatgpt.com/api/auth/session while logged in.
 *
 * ⚠️  This adapter uses an internal, undocumented API that may break at any time.
 *     Using it may violate OpenAI's Terms of Service.
 */
export class OpenAIWebAdapter implements ProviderAdapter {
  private getAccessToken(model: ModelConfig): string {
    if (!model.apiKey) {
      throw new Error(
        'openai-web: no access token configured. ' +
        'Visit https://chatgpt.com/api/auth/session while logged in and copy the "accessToken" field.',
      );
    }
    return model.apiKey;
  }

  private getUpstreamModelId(model: ModelConfig): string {
    if (model.upstreamModelId) return model.upstreamModelId;
    if (model.id.includes('/')) return model.id.split('/').slice(1).join('/');
    return model.id;
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
          const text = parts.filter(p => typeof p === 'string').join('');
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
    const endpoint = (model.endpoint || 'https://chatgpt.com') + '/backend-api/conversation';

    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(this.buildBody(request, model)),
    });

    if (!response.ok) {
      throw new Error(`openai-web: HTTP ${response.status} ${response.statusText}`);
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
    const endpoint = (model.endpoint || 'https://chatgpt.com') + '/backend-api/conversation';

    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(this.buildBody(request, model)),
    });

    if (!response.ok) {
      throw new Error(`openai-web: HTTP ${response.status} ${response.statusText}`);
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
