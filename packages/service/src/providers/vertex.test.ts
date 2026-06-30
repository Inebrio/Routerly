import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { ModelConfig } from '@routerly/shared';

// ── Mock OpenAI SDK ───────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockConstructorArgs: Record<string, unknown>[] = [];

vi.mock('openai', () => {
  function MockOpenAI(opts: Record<string, unknown>) {
    mockConstructorArgs.push(opts);
    return { chat: { completions: { create: mockCreate } } };
  }
  MockOpenAI.prototype = {};
  return { default: MockOpenAI };
});

afterEach(() => {
  vi.clearAllMocks();
  mockConstructorArgs.length = 0;
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseModel: ModelConfig = {
  id: 'vertex/gemini-1.5-pro',
  name: 'Vertex Gemini',
  provider: 'vertex',
  endpoint: '',
  cost: { inputPerMillion: 0.35, outputPerMillion: 1.05 },
  apiKey: 'fake-access-token',
  vertexProjectId: 'my-project',
  vertexLocation: 'us-central1',
};

const chatResponse = {
  id: 'chatcmpl-vertex',
  object: 'chat.completion',
  created: 1234567890,
  model: 'gemini-1.5-pro',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from Vertex' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

// RSA key for service account tests — generated once, reused across all SA tests.
// Different client_email values per test prevent tokenCache collisions.
const { privateKey: TEST_RSA_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function makeSAKey(email: string): string {
  return JSON.stringify({ client_email: email, private_key: TEST_RSA_KEY });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VertexAdapter — base URL construction', () => {
  it('builds correct Vertex AI OpenAI-compatible base URL', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse);
    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      baseModel,
    );

    const { baseURL } = mockConstructorArgs[0]!;
    expect(baseURL).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/us-central1/endpoints/openapi',
    );
  });

  it('uses custom vertexLocation in URL', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse);
    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      { ...baseModel, vertexLocation: 'europe-west4' },
    );

    const { baseURL } = mockConstructorArgs[0]!;
    expect(baseURL as string).toContain('europe-west4-aiplatform.googleapis.com');
    expect(baseURL as string).toContain('/locations/europe-west4/');
  });

  it('defaults to us-central1 when vertexLocation is not set', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse);
    const { VertexAdapter } = await import('./vertex.js');
    const { vertexLocation: _, ...noLocation } = baseModel as any;
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      noLocation,
    );

    expect(mockConstructorArgs[0]!.baseURL as string).toContain('us-central1-aiplatform.googleapis.com');
  });
});

describe('VertexAdapter — authentication', () => {
  it('uses apiKey directly when no service account key is set', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse);
    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      baseModel,
    );

    const args = mockConstructorArgs[0]!;
    expect(args.apiKey).toBe('fake-access-token');
    expect((args.defaultHeaders as Record<string, string>)['Authorization']).toBe('Bearer fake-access-token');
  });

  it('exchanges service account JWT for access token', async () => {
    const saKey = makeSAKey('exchange@test.iam.gserviceaccount.com');
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'exchanged-token-xyz' }),
    }) as any;
    mockCreate.mockResolvedValueOnce(chatResponse);

    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      { ...baseModel, vertexServiceAccountKey: saKey },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockConstructorArgs[0]!.apiKey).toBe('exchanged-token-xyz');
    expect((mockConstructorArgs[0]!.defaultHeaders as Record<string, string>)['Authorization']).toBe('Bearer exchanged-token-xyz');
  });

  it('caches access token — fetch called only once across two requests', async () => {
    const saKey = makeSAKey('cached@test.iam.gserviceaccount.com');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'cached-token-abc' }),
    }) as any;
    mockCreate.mockResolvedValue(chatResponse);

    const { VertexAdapter } = await import('./vertex.js');
    const adapter = new VertexAdapter();
    const model = { ...baseModel, vertexServiceAccountKey: saKey };
    await adapter.chatCompletion({ messages: [{ role: 'user' as const, content: 'First' }] } as any, model);
    await adapter.chatCompletion({ messages: [{ role: 'user' as const, content: 'Second' }] } as any, model);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on token exchange failure', async () => {
    const saKey = makeSAKey('fail@test.iam.gserviceaccount.com');
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as any;

    const { VertexAdapter } = await import('./vertex.js');
    await expect(
      new VertexAdapter().chatCompletion(
        { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
        { ...baseModel, vertexServiceAccountKey: saKey },
      ),
    ).rejects.toThrow('Vertex token exchange failed 401');
  });
});

describe('VertexAdapter — chatCompletion', () => {
  it('strips provider prefix from model ID', async () => {
    let capturedModel = '';
    mockCreate.mockImplementationOnce(async (opts: { model: string }) => {
      capturedModel = opts.model;
      return chatResponse;
    });
    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hi' }] } as any,
      baseModel,
    );
    expect(capturedModel).toBe('gemini-1.5-pro');
  });

  it('handles model ID without prefix', async () => {
    let capturedModel = '';
    mockCreate.mockImplementationOnce(async (opts: { model: string }) => {
      capturedModel = opts.model;
      return chatResponse;
    });
    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hi' }] } as any,
      { ...baseModel, id: 'gemini-2.0-flash' },
    );
    expect(capturedModel).toBe('gemini-2.0-flash');
  });

  it('forces stream: false regardless of request value', async () => {
    let capturedStream: unknown;
    mockCreate.mockImplementationOnce(async (opts: { stream: unknown }) => {
      capturedStream = opts.stream;
      return chatResponse;
    });
    const { VertexAdapter } = await import('./vertex.js');
    await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hi' }], stream: true } as any,
      baseModel,
    );
    expect(capturedStream).toBe(false);
  });

  it('returns full chat completion response', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse);
    const { VertexAdapter } = await import('./vertex.js');
    const resp = await new VertexAdapter().chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      baseModel,
    );
    expect(resp.choices[0]!.message.content).toBe('Hello from Vertex');
    expect(resp.object).toBe('chat.completion');
    expect(resp.usage.prompt_tokens).toBe(10);
  });
});

describe('VertexAdapter — streamCompletion', () => {
  it('yields chunks from the provider', async () => {
    const chunks = [
      { id: 'c1', choices: [{ delta: { content: 'Hel' } }] },
      { id: 'c2', choices: [{ delta: { content: 'lo' } }] },
    ];
    async function* fakeStream() { yield* chunks; }
    mockCreate.mockResolvedValueOnce(fakeStream());

    const { VertexAdapter } = await import('./vertex.js');
    const result: unknown[] = [];
    for await (const chunk of new VertexAdapter().streamCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      baseModel,
    )) {
      result.push(chunk);
    }
    expect(result).toHaveLength(2);
    expect((result[0] as any).choices[0].delta.content).toBe('Hel');
    expect((result[1] as any).choices[0].delta.content).toBe('lo');
  });

  it('strips provider prefix in stream mode', async () => {
    let capturedModel = '';
    async function* fakeStream() {}
    mockCreate.mockImplementationOnce(async (opts: { model: string }) => {
      capturedModel = opts.model;
      return fakeStream();
    });
    const { VertexAdapter } = await import('./vertex.js');
    for await (const _ of new VertexAdapter().streamCompletion(
      { messages: [{ role: 'user' as const, content: 'Hi' }] } as any,
      baseModel,
    )) {}
    expect(capturedModel).toBe('gemini-1.5-pro');
  });
});

describe('VertexAdapter — getClient', () => {
  it('throws with informative message (override forces use of chatCompletion/streamCompletion)', async () => {
    const { VertexAdapter } = await import('./vertex.js');
    expect(() => (new VertexAdapter() as any).getClient(baseModel)).toThrow(
      'VertexAdapter: use chatCompletion/streamCompletion directly',
    );
  });
});
