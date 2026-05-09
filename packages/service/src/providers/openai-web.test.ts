import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIWebAdapter } from './openai-web.js';
import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'openai-web/gpt-4o',
    name: 'GPT-4o (web)',
    provider: 'openai-web',
    endpoint: 'https://chatgpt.com',
    apiKey: 'test-access-token',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    ...overrides,
  };
}

function makeRequest(content = 'Hello'): ChatCompletionRequest {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content }],
  };
}

/** Build a ReadableStream that emits the given SSE lines followed by [DONE] */
function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = [
    ...events.map(e => `data: ${e}\n\n`),
    'data: [DONE]\n\n',
  ].join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
}

function sseEvent(text: string, model = 'gpt-4o'): string {
  return JSON.stringify({
    message: {
      status: 'in_progress',
      content: { content_type: 'text', parts: [text] },
      metadata: { model_slug: model },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('OpenAIWebAdapter.chatCompletion', () => {
  it('maps SSE parts to OpenAI chat completion response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        sseEvent('Hello'),
        sseEvent('Hello, world!'),
      ]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());

    expect(result.object).toBe('chat.completion');
    expect(result.choices[0]!.message.role).toBe('assistant');
    // Last accumulated text wins
    expect(result.choices[0]!.message.content).toBe('Hello, world!');
    expect(result.choices[0]!.finish_reason).toBe('stop');
  });

  it('includes system prompt in request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Hi' }] },
      makeModel(),
    );

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse((callArgs[1].body) as string) as Record<string, unknown>;
    expect(body['system_prompt']).toBe('Be concise.');
  });

  it('throws on HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));

    const adapter = new OpenAIWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel())).rejects.toThrow('HTTP 401');
  });

  it('throws when apiKey is missing', async () => {
    const adapter = new OpenAIWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel({ apiKey: undefined }))).rejects.toThrow('no access token');
  });
});

describe('OpenAIWebAdapter.streamCompletion', () => {
  it('emits content deltas in OpenAI chunk format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        sseEvent('Hello'),
        sseEvent('Hello, world!'),
      ]),
    }));

    const adapter = new OpenAIWebAdapter();
    const chunks: import('@routerly/shared').StreamChunk[] = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel())) {
      chunks.push(chunk);
    }

    // Should have delta chunks + final stop chunk
    const contentChunks = chunks.filter(c => c.choices[0]!.delta.content);
    expect(contentChunks.length).toBeGreaterThan(0);
    // All chunks are chat.completion.chunk
    expect(chunks.every(c => c.object === 'chat.completion.chunk')).toBe(true);
    // Last chunk has finish_reason stop
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe('stop');
  });

  it('emits only new text as delta (not accumulated text)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        sseEvent('Hi'),
        sseEvent('Hi there'),
        sseEvent('Hi there!'),
      ]),
    }));

    const adapter = new OpenAIWebAdapter();
    const deltas: string[] = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel())) {
      if (chunk.choices[0]!.delta.content) deltas.push(chunk.choices[0]!.delta.content);
    }

    expect(deltas).toEqual(['Hi', ' there', '!']);
  });
});
