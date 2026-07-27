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

    // calls[0] = sentinel/chat-requirements (GET), calls[1] = conversation (POST)
    const callArgs = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse((callArgs[1].body) as string) as Record<string, unknown>;
    expect(body['system_prompt']).toBe('Be concise.');
  });

  it('attaches sentinel headers when chat-requirements responds', async () => {
    const sentinelResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        token: 'sentinel-tok-123',
        proofofwork: { required: false, seed: '', difficulty: '' },
      }),
    };
    const conversationResponse = {
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sentinelResponse)
      .mockResolvedValueOnce(conversationResponse);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(makeRequest(), makeModel());

    const [sentinelUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentinelUrl).toContain('/backend-api/sentinel/chat-requirements');

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = conversationInit.headers as Record<string, string>;
    expect(headers['Openai-Sentinel-Chat-Requirements-Token']).toBe('sentinel-tok-123');
  });

  it('throws on HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve(''),
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

describe('OpenAIWebAdapter.cleanAnnotations (via SSE parsing)', () => {
  const MARKER = '\u{1F523}';

  function annotated(key: string, content: string): string {
    return `${MARKER}${JSON.stringify({ [key]: { content } })}${MARKER}`;
  }

  it('converts math_block_widget annotations to $$...$$', async () => {
    const raw = `Before${annotated('math_block_widget_always_prefetch_v2', '\\pi = \\frac{C}{d}')}After`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    const text = result.choices[0]!.message.content as string;
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain('math_block_widget');
    expect(text).toContain('$$');
    expect(text).toContain('\\pi = \\frac{C}{d}');
  });

  it('converts math_inline_widget annotations to $...$', async () => {
    const raw = `The constant ${annotated('math_inline_widget_always_prefetch_v2', '\\pi')} is irrational.`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    const text = result.choices[0]!.message.content as string;
    expect(text).toBe('The constant $\\pi$ is irrational.');
  });

  it('silently removes unknown annotations', async () => {
    const raw = `Hello${annotated('some_unknown_widget_v1', 'data')} world`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    const text = result.choices[0]!.message.content as string;
    expect(text).toBe('Hello world');
    expect(text).not.toContain(MARKER);
  });

  it('leaves plain text without annotations unchanged', async () => {
    const raw = 'Just normal text with no annotations.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toBe(raw);
  });

  it('throws when chatCompletion response body is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    }));

    const adapter = new OpenAIWebAdapter();
    await expect(adapter.chatCompletion(makeRequest(), makeModel())).rejects.toThrow('empty response body');
  });
});

describe('OpenAIWebAdapter sentinel proof-of-work required', () => {
  it('includes proof token when proofofwork.required is true', async () => {
    const sentinelResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        token: 'sentinel-tok-pow',
        proofofwork: { required: true, seed: 'seed-abc', difficulty: 'ffffffffffffffff' },
      }),
    }
    const conversationResponse = {
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sentinelResponse)
      .mockResolvedValueOnce(conversationResponse)
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new OpenAIWebAdapter()
    await adapter.chatCompletion(makeRequest(), makeModel())

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const headers = conversationInit.headers as Record<string, string>
    expect(headers['Openai-Sentinel-Chat-Requirements-Token']).toBe('sentinel-tok-pow')
    // Proof token header should be present
    expect(headers['Openai-Sentinel-Proof-Token']).toBeDefined()
  })
})

describe('OpenAIWebAdapter invalid JSON in SSE stream', () => {
  it('skips invalid JSON lines (continue branch in parseSSE)', async () => {
    const encoder = new TextEncoder()
    const streamWithBadJSON = new ReadableStream<Uint8Array>({
      start(controller) {
        const data = [
          `data: not-valid-json\n\n`,
          `data: ${sseEvent('Valid part')}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
        controller.enqueue(encoder.encode(data))
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamWithBadJSON }))

    const adapter = new OpenAIWebAdapter()
    const result = await adapter.chatCompletion(makeRequest(), makeModel())
    // Should get the valid content
    expect(result.choices[0]!.message.content).toBe('Valid part')
  })
})

describe('OpenAIWebAdapter.streamCompletion errors', () => {
  it('throws on HTTP error during streamCompletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'Access denied',
      body: null,
    }));

    const adapter = new OpenAIWebAdapter();
    const gen = adapter.streamCompletion(makeRequest(), makeModel())
    await expect(async () => { for await (const _ of gen) { /* consume */ } }).rejects.toThrow('HTTP 403')
  });

  it('throws when streamCompletion response body is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    }));

    const adapter = new OpenAIWebAdapter();
    const gen = adapter.streamCompletion(makeRequest(), makeModel())
    await expect(async () => { for await (const _ of gen) { /* consume */ } }).rejects.toThrow('empty response body')
  });
});

describe('OpenAIWebAdapter branch coverage: line 56 — cfClearance cookie', () => {
  it('sets Cookie header when cfClearance is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(makeRequest(), makeModel({ cfClearance: 'cf-test-value-abc123' }));

    // calls[0] = sentinel (GET), calls[1] = conversation (POST)
    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = conversationInit.headers as Record<string, string>;
    expect(headers['Cookie']).toBe('cf_clearance=cf-test-value-abc123');
  });
});

describe('OpenAIWebAdapter branch coverage: line 64 — getUpstreamModelId without slash', () => {
  it('returns model.id as-is when it contains no slash and upstreamModelId is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    // model.id without "/" — should hit `return model.id` at line 64
    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(
      makeRequest(),
      makeModel({ id: 'gpt-4o' }),
    );

    // The model returned should be the model_slug from SSE, or fallback to model.id
    expect(result.object).toBe('chat.completion');

    // Also verify the upstream model id used in the request body is 'gpt-4o'
    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse((conversationInit.body) as string) as Record<string, unknown>;
    expect(body['model']).toBe('gpt-4o');
  });
});

describe('OpenAIWebAdapter branch coverage: lines 111-112 — generateProofToken fallback', () => {
  it('uses fallback token when no nonce satisfies an impossibly strict difficulty', async () => {
    // A 128-character difficulty of zeros is impossible to satisfy within 100k iterations,
    // so generateProofToken will hit the fallback path at lines 111-112.
    const impossibleDifficulty = '0'.repeat(128);
    const sentinelResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        token: 'sentinel-tok-fallback',
        proofofwork: {
          required: true,
          seed: 'test-seed-for-fallback',
          difficulty: impossibleDifficulty,
        },
      }),
    };
    const conversationResponse = {
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sentinelResponse)
      .mockResolvedValueOnce(conversationResponse);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(makeRequest(), makeModel());

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = conversationInit.headers as Record<string, string>;
    // The proof token should start with the fallback prefix
    expect(headers['Openai-Sentinel-Proof-Token']).toMatch(/^gAAAAABwQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D/);
  });
});

describe('OpenAIWebAdapter branch coverage: line 265 — parseSSE stream ends without [DONE]', () => {
  it('handles a stream that closes without a [DONE] marker', async () => {
    // Build a stream that sends SSE content but no [DONE] line.
    // The reader.read() will return done=true, hitting the `if (done) break` path (line 255)
    // and the generator returns normally without yielding the done sentinel.
    const encoder = new TextEncoder();
    const streamNoDone = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${sseEvent('No done marker')}\n\n`));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamNoDone }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toBe('No done marker');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 62 — upstreamModelId explicitly set
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter branch coverage: line 62 — upstreamModelId explicitly set', () => {
  it('uses model.upstreamModelId when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(
      makeRequest(),
      makeModel({ id: 'openai-web/gpt-4o', upstreamModelId: 'gpt-4o-upstream' }),
    );

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse((conversationInit.body) as string) as Record<string, unknown>;
    expect(body['model']).toBe('gpt-4o-upstream');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 140 — sentinel returns no token (data.token falsy)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter branch coverage: line 140 — sentinel returns no token', () => {
  it('proceeds without sentinel header when data.token is absent', async () => {
    const sentinelResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ proofofwork: { required: false } }),
    };
    const conversationResponse = {
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sentinelResponse)
      .mockResolvedValueOnce(conversationResponse);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = conversationInit.headers as Record<string, string>;
    expect(headers['Openai-Sentinel-Chat-Requirements-Token']).toBeUndefined();
    expect(result.object).toBe('chat.completion');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for lines 166 & 169 — assistant role and non-string content
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter branch coverage: line 166 — assistant role in buildMessages', () => {
  it('maps assistant messages to role="assistant"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'World' },
          { role: 'user', content: 'Again' },
        ],
      },
      makeModel(),
    );

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse((conversationInit.body) as string) as Record<string, unknown>;
    const messages = body['messages'] as Array<{ author: { role: string }; content: { parts: string[] } }>;
    expect(messages[1]!.author.role).toBe('assistant');
  });
});

describe('OpenAIWebAdapter branch coverage: line 169 — non-string message content', () => {
  it('JSON.stringifies non-string message content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    // Pass content as an array (multimodal-style), which is non-string
    await adapter.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] as unknown as string }],
      },
      makeModel(),
    );

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse((conversationInit.body) as string) as Record<string, unknown>;
    const messages = body['messages'] as Array<{ content: { parts: string[] } }>;
    expect(typeof messages[0]!.content.parts[0]).toBe('string');
    // Should be JSON.stringify of the array
    expect(messages[0]!.content.parts[0]).toContain('text');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 184 — non-string system message content
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter branch coverage: line 184 — non-string system message content', () => {
  it('JSON.stringifies non-string systemMessage.content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    await adapter.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'system' }] as unknown as string },
          { role: 'user', content: 'Hello' },
        ],
      },
      makeModel(),
    );

    const [, conversationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse((conversationInit.body) as string) as Record<string, unknown>;
    expect(typeof body['system_prompt']).toBe('string');
    expect((body['system_prompt'] as string)).toContain('text');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 210 — MARKER followed by non-{ character
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter cleanAnnotations: MARKER not followed by {', () => {
  it('skips annotation when MARKER is not followed by {', async () => {
    const MARKER = '\u{1F523}';
    // Place MARKER followed by non-{ character — should be skipped
    const raw = `Hello${MARKER}not-json world`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    // The MARKER and trailing text should remain (not cleaned), but no crash
    expect(result.choices[0]!.message.content).toContain('Hello');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 219 — unclosed braces (depth !== 0)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter cleanAnnotations: unclosed JSON braces', () => {
  it('skips annotation when braces are not balanced', async () => {
    const MARKER = '\u{1F523}';
    // MARKER + { unclosed — depth will be nonzero at end of string
    const raw = `Hello${MARKER}{"key": {"nested": "open" world`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toContain('Hello');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 221 — closing MARKER check fails (no trailing MARKER)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter cleanAnnotations: closing MARKER absent', () => {
  it('skips annotation when closing MARKER is absent after JSON', async () => {
    const MARKER = '\u{1F523}';
    // MARKER + valid JSON but no closing MARKER
    const raw = `Hello${MARKER}{"key": {"content": "x"}} world`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toContain('Hello');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 227 — Object.keys(ann)[0] is undefined (empty object)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter cleanAnnotations: empty annotation object', () => {
  it('handles empty annotation object gracefully', async () => {
    const MARKER = '\u{1F523}';
    // Valid JSON but empty object — Object.keys(ann)[0] === undefined, key = ''
    const raw = `Hello${MARKER}{}${MARKER} world`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    // Empty object → empty key → no math prefix match → silently dropped
    expect(result.choices[0]!.message.content).toBe('Hello world');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 229 — inner.content is undefined
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter cleanAnnotations: annotation with no content field', () => {
  it('treats missing content as empty string', async () => {
    const MARKER = '\u{1F523}';
    // Annotation with key but inner has no "content" field
    const raw = `Before${MARKER}${JSON.stringify({ math_inline_widget_v1: { other: 'x' } })}${MARKER}After`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent(raw)]),
    }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    // math_inline_widget with no content → replacement = '$$'
    expect(result.choices[0]!.message.content).toBe('Before$$After');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 274 — SSE message field is undefined
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter parseSSE: no message field in SSE data', () => {
  it('skips SSE events without a message field', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const lines = [
          `data: ${JSON.stringify({ other: 'data' })}\n\n`,
          `data: ${sseEvent('Real content')}\n\n`,
          'data: [DONE]\n\n',
        ].join('');
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toBe('Real content');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for lines 276 & 279 — status not in_progress/finished_successfully
// and parts not an array
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter parseSSE: unrecognised status skipped', () => {
  it('skips SSE events whose status is not in_progress or finished_successfully', async () => {
    const encoder = new TextEncoder();
    const eventWithWrongStatus = JSON.stringify({
      message: {
        status: 'created',
        content: { content_type: 'text', parts: ['ignored'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const lines = [
          `data: ${eventWithWrongStatus}\n\n`,
          `data: ${sseEvent('Good content')}\n\n`,
          'data: [DONE]\n\n',
        ].join('');
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toBe('Good content');
  });
});

describe('OpenAIWebAdapter parseSSE: parts field missing or not array', () => {
  it('skips SSE events when content.parts is not an array', async () => {
    const encoder = new TextEncoder();
    const eventNoArray = JSON.stringify({
      message: {
        status: 'in_progress',
        content: { content_type: 'text', parts: 'not-an-array' },
        metadata: { model_slug: 'gpt-4o' },
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const lines = [
          `data: ${eventNoArray}\n\n`,
          `data: ${sseEvent('Real text')}\n\n`,
          'data: [DONE]\n\n',
        ].join('');
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.choices[0]!.message.content).toBe('Real text');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 284 — model_slug absent (metadata.model_slug undefined)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter parseSSE: model_slug absent in metadata', () => {
  it('yields empty model string when model_slug is missing', async () => {
    const encoder = new TextEncoder();
    const eventNoSlug = JSON.stringify({
      message: {
        status: 'in_progress',
        content: { content_type: 'text', parts: ['text with no slug'] },
        metadata: {},
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const lines = [
          `data: ${eventNoSlug}\n\n`,
          'data: [DONE]\n\n',
        ].join('');
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel({ upstreamModelId: 'fallback-model' }));
    // model_slug is '' so finalModel stays as upstreamModelId
    expect(result.model).toBe('fallback-model');
    expect(result.choices[0]!.message.content).toBe('text with no slug');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 299 — model.endpoint falsy (uses default https://chatgpt.com)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter branch coverage: line 299 — default endpoint', () => {
  it('uses https://chatgpt.com when model.endpoint is undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    // makeModel without endpoint override — endpoint defaults to 'https://chatgpt.com' in makeModel,
    // but we need it absent so we use an object spread omitting 'endpoint'
    const modelNoEndpoint = { ...makeModel(), endpoint: 'https://chatgpt.com' };
    // Actually use a model that has no endpoint key — we can just use makeModel() since its default IS chatgpt.com
    // For this test to hit the `|| 'https://chatgpt.com'` branch we need endpoint to be falsy (empty string)
    await adapter.chatCompletion(makeRequest(), { ...makeModel(), endpoint: '' });

    // sentinel call goes to default base URL (empty string → falls back to 'https://chatgpt.com')
    const [sentinelUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentinelUrl).toContain('https://chatgpt.com');
    const [conversationUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(conversationUrl).toBe('https://chatgpt.com/backend-api/conversation');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 316 — chatCompletion HTTP error with empty detail
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter chatCompletion: HTTP error with empty response text', () => {
  it('throws error without " — " suffix when response text is empty', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: () => Promise.resolve(''),
      }));

    const adapter = new OpenAIWebAdapter();
    let caught: Error | undefined;
    await adapter.chatCompletion(makeRequest(), makeModel()).catch((e: Error) => { caught = e; });
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('HTTP 429 Too Many Requests');
    expect(caught!.message).not.toContain(' — ');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 328 — chunk.model falsy in chatCompletion
// (SSE events with empty model_slug don't update finalModel)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter chatCompletion: chunk.model falsy keeps upstreamModelId', () => {
  it('retains upstreamModelId when SSE chunks have no model_slug', async () => {
    const encoder = new TextEncoder();
    const eventNoSlug = JSON.stringify({
      message: {
        status: 'in_progress',
        content: { content_type: 'text', parts: ['response text'] },
        metadata: {},  // no model_slug
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${eventNoSlug}\n\ndata: [DONE]\n\n`));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const result = await adapter.chatCompletion(makeRequest(), makeModel({ upstreamModelId: 'my-model' }));
    expect(result.model).toBe('my-model');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 356 — streamCompletion default endpoint
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter streamCompletion: default endpoint when model.endpoint falsy', () => {
  it('uses https://chatgpt.com as default endpoint in streamCompletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([sseEvent('Hi')]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    const chunks = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), { ...makeModel(), endpoint: '' })) {
      chunks.push(chunk);
    }

    const [conversationUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(conversationUrl).toBe('https://chatgpt.com/backend-api/conversation');
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 373 — streamCompletion HTTP error with empty detail
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter streamCompletion: HTTP error with empty response text', () => {
  it('throws error without " — " suffix when response text is empty in streamCompletion', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve(''),
      }));

    const adapter = new OpenAIWebAdapter();
    let errorMessage = '';
    const gen = adapter.streamCompletion(makeRequest(), makeModel());
    await (async () => {
      for await (const _ of gen) { /* consume */ }
    })().catch((e: Error) => { errorMessage = e.message; });

    expect(errorMessage).toContain('HTTP 503 Service Unavailable');
    expect(errorMessage).not.toContain(' — ');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 386 — chunk.model falsy in streamCompletion
// and line 390 — delta is empty (no new content)
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter streamCompletion: chunk.model falsy keeps upstreamModelId', () => {
  it('retains upstreamModelId when SSE chunks have no model_slug in streamCompletion', async () => {
    const encoder = new TextEncoder();
    const eventNoSlug = JSON.stringify({
      message: {
        status: 'in_progress',
        content: { content_type: 'text', parts: ['hello'] },
        metadata: {},  // no model_slug → chunk.model === ''
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${eventNoSlug}\n\ndata: [DONE]\n\n`));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const chunks = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel({ upstreamModelId: 'kept-model' }))) {
      chunks.push(chunk);
    }
    // All content chunks should use the kept model
    const contentChunks = chunks.filter(c => c.choices[0]!.delta.content);
    expect(contentChunks.every(c => c.model === 'kept-model')).toBe(true);
  });
});

describe('OpenAIWebAdapter streamCompletion: empty delta not emitted', () => {
  it('does not emit a content chunk when delta is empty (same text repeated)', async () => {
    const encoder = new TextEncoder();
    // Two events with identical text — second delta would be ''
    const event1 = JSON.stringify({
      message: {
        status: 'in_progress',
        content: { content_type: 'text', parts: ['hello'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    });
    // Same text again — delta would be ''
    const event2 = JSON.stringify({
      message: {
        status: 'in_progress',
        content: { content_type: 'text', parts: ['hello'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${event1}\n\ndata: ${event2}\n\ndata: [DONE]\n\n`));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: stream }));

    const adapter = new OpenAIWebAdapter();
    const chunks = [];
    for await (const chunk of adapter.streamCompletion(makeRequest(), makeModel())) {
      chunks.push(chunk);
    }
    // Only 1 content chunk (for 'hello'), then 1 stop chunk — no duplicate empty delta
    const contentChunks = chunks.filter(c => c.choices[0]!.delta.content);
    expect(contentChunks.length).toBe(1);
    expect(contentChunks[0]!.choices[0]!.delta.content).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for line 316 true branch — chatCompletion HTTP error with non-empty detail
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter chatCompletion: HTTP error with non-empty detail', () => {
  it('includes " — detail" in error message when response body is non-empty', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('invalid token provided'),
      }));

    const adapter = new OpenAIWebAdapter();
    let caught: Error | undefined;
    await adapter.chatCompletion(makeRequest(), makeModel()).catch((e: Error) => { caught = e; });
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('HTTP 401 Unauthorized');
    expect(caught!.message).toContain(' — invalid token provided');
  });
});

// ---------------------------------------------------------------------------
// Function coverage: .catch(() => '') callbacks on response.text()
// lines 132, 315, 372 — response.text() rejects
// ---------------------------------------------------------------------------
describe('OpenAIWebAdapter: response.text() rejects — catch(() => \'\') callbacks', () => {
  it('chatCompletion uses empty detail when response.text() throws', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.reject(new Error('stream error')),
      }));

    const adapter = new OpenAIWebAdapter();
    let caught: Error | undefined;
    await adapter.chatCompletion(makeRequest(), makeModel()).catch((e: Error) => { caught = e; });
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('HTTP 500 Internal Server Error');
    // detail is '' because text() threw — no " — " suffix
    expect(caught!.message).not.toContain(' — ');
  });

  it('streamCompletion uses empty detail when response.text() throws', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.reject(new Error('stream error')),
      }));

    const adapter = new OpenAIWebAdapter();
    let errorMessage = '';
    const gen = adapter.streamCompletion(makeRequest(), makeModel());
    await (async () => {
      for await (const _ of gen) { /* consume */ }
    })().catch((e: Error) => { errorMessage = e.message; });

    expect(errorMessage).toContain('HTTP 500 Internal Server Error');
    expect(errorMessage).not.toContain(' — ');
  });

  it('sentinel getSentinelHeaders uses empty body when response.text() throws', async () => {
    // Make sentinel response non-ok and text() throw
    // This covers line 132: .catch(() => '')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.reject(new Error('text error')),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSSEStream([sseEvent('Hi')]),
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIWebAdapter();
    // Should not throw — sentinel failure is graceful, returns {}
    const result = await adapter.chatCompletion(makeRequest(), makeModel());
    expect(result.object).toBe('chat.completion');
  });
});
