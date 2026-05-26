import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicWebAdapter } from './anthropic-web.js';
import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'anthropic-web/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (web)',
    provider: 'anthropic-web',
    endpoint: 'https://claude.ai',
    apiKey: 'sk-ant-sid01-test',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    ...overrides,
  };
}

function makeRequest(content = 'Hello'): ChatCompletionRequest {
  return {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content }],
  };
}

/** Build a ReadableStream that emits completion SSE events */
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

function completionEvent(text: string, model = 'claude-sonnet-4-6'): string {
  return JSON.stringify({ type: 'completion', completion: text, model });
}

const ORGS_RESPONSE = [{ uuid: 'org-test-123' }];
const CONV_RESPONSE = { uuid: 'conv-abc-456' };

/** Create a fetch mock that handles the 3-step flow */
function makeFetchMock(completionStream: ReadableStream<Uint8Array>) {
  return vi.fn((url: string) => {
    if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
    }
    if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
    }
    // completion endpoint
    return Promise.resolve({ ok: true, body: completionStream });
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AnthropicWebAdapter.chatCompletion', () => {
  it('maps SSE completion events to OpenAI chat completion response', async () => {
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([
      completionEvent(' Hello'),
      completionEvent(', world!'),
    ])));

    const adapter = new AnthropicWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());

    expect(result.object).toBe('chat.completion');
    expect(result.choices[0]!.message.role).toBe('assistant');
    expect(result.choices[0]!.message.content).toBe(' Hello, world!');
    expect(result.choices[0]!.finish_reason).toBe('stop');
  });

  it('throws when apiKey is missing', async () => {
    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel({ apiKey: undefined }))).rejects.toThrow('no session key');
  });

  it('throws on HTTP error from organizations endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve(''),
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel())).rejects.toThrow('HTTP 401');
  });
});

describe('AnthropicWebAdapter orgId caching', () => {
  it('fetches organizations only once across multiple calls', async () => {
    const stream1 = makeSSEStream([completionEvent('One')]);
    const stream2 = makeSSEStream([completionEvent('Two')]);
    let completionCallCount = 0;

    const fetchMock = vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      completionCallCount++;
      return Promise.resolve({ ok: true, body: completionCallCount === 1 ? stream1 : stream2 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AnthropicWebAdapter();
    await adapter.chatCompletion(makeRequest('First'), makeModel());
    await adapter.chatCompletion(makeRequest('Second'), makeModel());

    const orgCalls = fetchMock.mock.calls.filter(
      (call) => (call[0]! as string).includes('/api/organizations') && !(call[0]! as string).includes('chat_conversations'),
    );
    expect(orgCalls).toHaveLength(1);
  });
});

describe('AnthropicWebAdapter.streamCompletion', () => {
  it('emits content deltas in OpenAI chunk format', async () => {
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([
      completionEvent(' Hi'),
      completionEvent(' there'),
    ])));

    const adapter = new AnthropicWebAdapter();
    const chunks: import('@routerly/shared').StreamChunk[] = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel())) {
      chunks.push(chunk);
    }

    expect(chunks.every(c => c.object === 'chat.completion.chunk')).toBe(true);
    const deltas = chunks.flatMap(c => c.choices[0]!.delta.content ? [c.choices[0]!.delta.content] : []);
    expect(deltas).toEqual([' Hi', ' there']);
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe('stop');
  });
});
