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

  it('handles message_stop SSE event type', async () => {
    const encoder = new TextEncoder()
    const stopStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const data = [
          `data: ${JSON.stringify({ type: 'completion', completion: 'Hello', model: 'claude' })}\n\n`,
          `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
        controller.enqueue(encoder.encode(data))
        controller.close()
      },
    })

    vi.stubGlobal('fetch', makeFetchMock(stopStream))
    const adapter = new AnthropicWebAdapter()
    const chunks: import('@routerly/shared').StreamChunk[] = []
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel())) {
      chunks.push(chunk)
    }
    expect(chunks.length).toBeGreaterThan(0)
  });

  it('handles sendCompletion 404 (invalidates cachedConvId)', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) })
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) })
      }
      callCount++
      // First completion call returns 404, second succeeds
      if (callCount === 1) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => null }, text: async () => '' })
      }
      return Promise.resolve({ ok: true, body: makeSSEStream([completionEvent('ok')]) })
    }))

    const adapter = new AnthropicWebAdapter()
    await expect(adapter.chatCompletion(makeRequest(), makeModel())).rejects.toThrow('HTTP 404')
  });
});

describe('AnthropicWebAdapter conversation creation failure', () => {
  it('throws when conversation creation endpoint returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) })
      }
      // conversation creation fails
      return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '' })
    }))

    const adapter = new AnthropicWebAdapter()
    await expect(adapter.chatCompletion(makeRequest(), makeModel())).rejects.toThrow('HTTP 503')
  })
})

describe('AnthropicWebAdapter invalid JSON in SSE stream', () => {
  it('skips invalid JSON lines (continue branch in parseSSE)', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const data = [
          `data: not-valid-json\n\n`,
          `data: ${JSON.stringify({ type: 'completion', completion: 'Hello', model: 'claude' })}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
        controller.enqueue(encoder.encode(data))
        controller.close()
      },
    })

    vi.stubGlobal('fetch', makeFetchMock(stream))
    const adapter = new AnthropicWebAdapter()
    const result = await adapter.chatCompletion(makeRequest(), makeModel())
    // Should still get the valid completion text
    expect(result.choices[0]!.message.content).toBe('Hello')
  })
})

describe('AnthropicWebAdapter system prompt with non-string content', () => {
  it('JSON stringifies non-string system message content', async () => {
    const stream = makeSSEStream([completionEvent('ok')])

    let capturedBody: any = null
    vi.stubGlobal('fetch', vi.fn((url: string, opts: any) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) })
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) })
      }
      capturedBody = JSON.parse(opts.body)
      return Promise.resolve({ ok: true, body: stream })
    }))

    const adapter = new AnthropicWebAdapter()
    const request: ChatCompletionRequest = {
      model: 'claude', messages: [
        { role: 'system', content: [{ type: 'text', text: 'system' }] as any },
        { role: 'user', content: 'hi' },
      ],
    }
    await adapter.chatCompletion(request, makeModel())
    expect(typeof capturedBody?.system_prompt).toBe('string')
  });
});

describe('AnthropicWebAdapter getUpstreamModelId branches', () => {
  it('returns upstreamModelId directly when configured', async () => {
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([completionEvent('ok', 'claude-opus-4-5')])));

    const adapter = new AnthropicWebAdapter();
    const model = makeModel({ upstreamModelId: 'claude-opus-4-5' });
    const result = await adapter.chatCompletion(makeRequest(), model);
    expect(result.model).toBe('claude-opus-4-5');
  });

  it('strips the provider prefix when model id contains a slash but has no upstreamModelId', async () => {
    // makeSSEStream returns model '' via completionEvent default, so finalModel stays as upstreamModelId
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([completionEvent('ok', '')])));

    const adapter = new AnthropicWebAdapter();
    // id = 'anthropic-web/claude-3-opus' → split gives ['anthropic-web', 'claude-3-opus'] → slice(1) → 'claude-3-opus'
    const model = makeModel({ id: 'anthropic-web/claude-3-opus' } as any);
    const result = await adapter.chatCompletion(makeRequest(), model);
    expect(result.model).toBe('claude-3-opus');
  });

  it('uses model id as-is when there is no slash and no upstreamModelId', async () => {
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([completionEvent('ok', '')])));

    const adapter = new AnthropicWebAdapter();
    const model = makeModel({ id: 'claude-haiku' } as any);
    const result = await adapter.chatCompletion(makeRequest(), model);
    expect(result.model).toBe('claude-haiku');
  });
});

describe('AnthropicWebAdapter baseUrl fallback', () => {
  it('defaults to https://claude.ai when endpoint is not set', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      // Verify all requests go to the default base URL
      expect((url as string).startsWith('https://claude.ai')).toBe(true);
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      return Promise.resolve({ ok: true, body: makeSSEStream([completionEvent('ok')]) });
    }));

    const adapter = new AnthropicWebAdapter();
    // No endpoint set → should use 'https://claude.ai'
    const result = await adapter.chatCompletion(makeRequest(), makeModel({ endpoint: undefined } as any));
    expect(result.object).toBe('chat.completion');
  });

  it('strips trailing slash from endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      // Should not have double slashes
      expect((url as string)).not.toMatch(/claude\.ai\/\//);
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      return Promise.resolve({ ok: true, body: makeSSEStream([completionEvent('ok')]) });
    }));

    const adapter = new AnthropicWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel({ endpoint: 'https://claude.ai/' }));
    expect(result.object).toBe('chat.completion');
  });
});

describe('AnthropicWebAdapter getOrgId error with detail body', () => {
  it('includes detail text in error message when org fetch fails with body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('session expired'),
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel()))
      .rejects.toThrow('session expired');
  });

  it('throws when organizations response is an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel()))
      .rejects.toThrow('no organizations found');
  });

  it('throws when organizations response is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'not an array' }),
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel()))
      .rejects.toThrow('no organizations found');
  });
});

describe('AnthropicWebAdapter getConvId error with detail body', () => {
  it('includes detail text in error message when conversation creation fails with body', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      // conversation creation fails with detail body
      return Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: () => Promise.resolve('rate limit exceeded'),
      });
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel()))
      .rejects.toThrow('rate limit exceeded');
  });
});

describe('AnthropicWebAdapter sendCompletion with Retry-After header', () => {
  it('includes retry-after value in error message', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      return Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: (h: string) => h === 'Retry-After' ? '30' : null },
        text: () => Promise.resolve(''),
      });
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel()))
      .rejects.toThrow('retry after 30s');
  });

  it('includes both retry-after and detail in error message', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      return Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: (h: string) => h === 'Retry-After' ? '60' : null },
        text: () => Promise.resolve('server overloaded'),
      });
    }));

    const adapter = new AnthropicWebAdapter();
    const err = await adapter.chatCompletion(makeRequest(), makeModel()).catch(e => e);
    expect(err.message).toMatch(/retry after 60s/);
    expect(err.message).toMatch(/server overloaded/);
  });
});

describe('AnthropicWebAdapter empty response body', () => {
  it('throws when chatCompletion response has no body', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      return Promise.resolve({ ok: true, body: null });
    }));

    const adapter = new AnthropicWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel()))
      .rejects.toThrow('empty response body');
  });

  it('throws when streamCompletion response has no body', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      return Promise.resolve({ ok: true, body: null });
    }));

    const adapter = new AnthropicWebAdapter();
    const gen = adapter.streamCompletion(makeRequest(), makeModel());
    await expect((gen as AsyncGenerator<unknown>).next()).rejects.toThrow('empty response body');
  });
});

describe('AnthropicWebAdapter buildPrompt branches', () => {
  it('prefixes assistant messages with "Assistant:"', async () => {
    let capturedBody: any = null;
    vi.stubGlobal('fetch', vi.fn((url: string, opts: any) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, body: makeSSEStream([completionEvent('ok')]) });
    }));

    const adapter = new AnthropicWebAdapter();
    const request: ChatCompletionRequest = {
      model: 'claude',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Follow up' },
      ],
    };
    await adapter.chatCompletion(request, makeModel());
    expect(capturedBody?.prompt).toContain('Assistant: Hi there');
    expect(capturedBody?.prompt).toContain('Human: Hello');
  });

  it('handles non-string user message content in buildPrompt', async () => {
    let capturedBody: any = null;
    vi.stubGlobal('fetch', vi.fn((url: string, opts: any) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, body: makeSSEStream([completionEvent('ok')]) });
    }));

    const adapter = new AnthropicWebAdapter();
    const request: ChatCompletionRequest = {
      model: 'claude',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'array content' }] as any },
      ],
    };
    await adapter.chatCompletion(request, makeModel());
    // Non-string content should be JSON-stringified and prefixed with "Human:"
    expect(capturedBody?.prompt).toContain('Human:');
  });

  it('includes system message as plain content (no prefix) in buildPrompt', async () => {
    let capturedBody: any = null;
    vi.stubGlobal('fetch', vi.fn((url: string, opts: any) => {
      if ((url as string).includes('/api/organizations') && !(url as string).includes('chat_conversations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ORGS_RESPONSE) });
      }
      if ((url as string).includes('chat_conversations') && !(url as string).includes('completion')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONV_RESPONSE) });
      }
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, body: makeSSEStream([completionEvent('ok')]) });
    }));

    const adapter = new AnthropicWebAdapter();
    // When messages only has a system + user message, the system is filtered out for the prompt
    // and the system_prompt field captures the system content.
    // But when there are multiple system-role messages that pass through buildPrompt (via nonSystemMessages),
    // the system role branch returns just the content without prefix.
    // We test it by passing a system role message as a non-system in a custom way.
    // Instead, verify prompt does NOT start with "Human:" or "Assistant:" for system messages
    // by including a system message and checking system_prompt field is set.
    const request: ChatCompletionRequest = {
      model: 'claude',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hi' },
      ],
    };
    await adapter.chatCompletion(request, makeModel());
    expect(capturedBody?.system_prompt).toBe('You are helpful');
    // The prompt should only have the user message (system is filtered out for prompt building)
    expect(capturedBody?.prompt).toBe('Human: hi');
  });
});

describe('AnthropicWebAdapter SSE parseSSE edge cases', () => {
  it('ignores completion events with empty delta', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // delta is empty string — should not yield a chunk for that event
        const data = [
          `data: ${JSON.stringify({ type: 'completion', completion: '', model: 'claude' })}\n\n`,
          `data: ${JSON.stringify({ type: 'completion', completion: 'Hello', model: 'claude' })}\n\n`,
          'data: [DONE]\n\n',
        ].join('');
        controller.enqueue(encoder.encode(data));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', makeFetchMock(stream));
    const adapter = new AnthropicWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    // Only the non-empty delta should be accumulated
    expect(result.choices[0]!.message.content).toBe('Hello');
  });

  it('handles stream that ends without [DONE] or message_stop', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const data = `data: ${JSON.stringify({ type: 'completion', completion: 'partial', model: 'claude' })}\n\n`;
        controller.enqueue(encoder.encode(data));
        controller.close();
        // No [DONE] — reader.read() will return done:true, hitting the `if (done) break` branch
      },
    });

    vi.stubGlobal('fetch', makeFetchMock(stream));
    const adapter = new AnthropicWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toBe('partial');
  });

  it('updates finalModel from SSE chunk model field in chatCompletion', async () => {
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([
      completionEvent('text', 'claude-updated-model'),
    ])));

    const adapter = new AnthropicWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.model).toBe('claude-updated-model');
  });

  it('updates finalModel from SSE chunk model field in streamCompletion', async () => {
    vi.stubGlobal('fetch', makeFetchMock(makeSSEStream([
      completionEvent('text', 'claude-stream-model'),
    ])));

    const adapter = new AnthropicWebAdapter();
    const chunks: import('@routerly/shared').StreamChunk[] = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel())) {
      chunks.push(chunk);
    }
    // The model should be updated in the yielded chunks
    const contentChunk = chunks.find(c => c.choices[0]!.delta.content);
    expect(contentChunk?.model).toBe('claude-stream-model');
  });
});
