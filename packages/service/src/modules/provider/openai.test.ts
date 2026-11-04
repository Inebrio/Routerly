import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAdapter } from './openai.js';
import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';

const create = vi.hoisted(() => {
  // The adapter calls create(...).withResponse(); mirror the SDK's APIPromise.
  const f = vi.fn();
  f.mockResolvedValue = ((v: unknown) =>
    f.mockReturnValue(Object.assign(Promise.resolve(v), { withResponse: async () => ({ data: v, response: { headers: new Headers() } }) }))) as typeof f.mockResolvedValue;
  return f;
});

vi.mock('openai', () => {
  class OpenAIMock {
    chat = { completions: { create } };
  }
  return { default: OpenAIMock };
});

afterEach(() => vi.clearAllMocks());

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    cost: { inputPerMillion: 5, outputPerMillion: 15 },
    ...overrides,
  };
}

function makeResponse() {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };
}

describe('OpenAIAdapter.chatCompletion', () => {
  it('strips the `input` field before forwarding to Chat Completions API', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    const request: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      input: [{ role: 'user', content: 'Hello' }], // simulate /v1/responses leak
    };

    await adapter.chatCompletion(request, makeModel());

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('input');
    expect(calledWith).toHaveProperty('messages');
  });

  it('does not add or force `stream` on a non-streaming call', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], stream: true },
      makeModel(),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('stream');
  });

  it('leaves max_tokens untouched for models that accept it', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 512 },
      makeModel(),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('max_tokens', 512);
    expect(calledWith).not.toHaveProperty('max_completion_tokens');
  });

  it('strips reasoning params for non-o-series models', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        reasoning_effort: 'high',
        reasoning_summary: 'auto',
      } as ChatCompletionRequest,
      makeModel(),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('reasoning_effort');
    expect(calledWith).not.toHaveProperty('reasoning_summary');
  });

  it('preserves reasoning params for o-series models', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      {
        model: 'o3-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        reasoning_effort: 'high',
      } as ChatCompletionRequest,
      makeModel({ id: 'o3-mini' }),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('reasoning_effort', 'high');
  });

  it('preserves reasoning_effort for gpt-5 and strips it for gpt-5-chat', async () => {
    const adapter = new OpenAIAdapter();
    for (const [id, kept] of [['gpt-5', true], ['gpt-5-mini', true], ['gpt-5-chat-latest', false], ['gpt-4o', false]] as const) {
      create.mockResolvedValue(makeResponse());
      await adapter.chatCompletion(
        { model: id, messages: [{ role: 'user', content: 'Hi' }], reasoning_effort: 'high' } as ChatCompletionRequest,
        makeModel({ id }),
      );
      const calledWith = create.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect('reasoning_effort' in calledWith).toBe(kept);
    }
  });

  it('uses max_completion_tokens when both max_tokens and max_completion_tokens are set', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'o3', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, max_completion_tokens: 200 },
      makeModel({ id: 'o3' }),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('max_completion_tokens', 200);
    expect(calledWith).not.toHaveProperty('max_tokens');
  });
});

describe('OpenAIAdapter.streamCompletion', () => {
  it('yields chunks from the provider', async () => {
    const chunks = [
      { id: 'c1', choices: [{ delta: { content: 'Hel' } }] },
      { id: 'c2', choices: [{ delta: { content: 'lo' } }] },
    ];
    async function* fakeStream() { yield* chunks; }
    create.mockResolvedValue(fakeStream());

    const adapter = new OpenAIAdapter();
    const result: unknown[] = [];
    for await (const chunk of adapter.streamCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] },
      makeModel(),
    )) {
      result.push(chunk);
    }

    expect(result).toHaveLength(2);
    expect((result[0] as any).choices[0].delta.content).toBe('Hel');
  });

  it('passes stream: true to the client', async () => {
    async function* empty() { /* drain */ }
    create.mockResolvedValue(empty());

    const adapter = new OpenAIAdapter();
    for await (const _ of adapter.streamCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel(),
    )) { /* drain */ }

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('stream', true);
  });
});

describe('OpenAIAdapter.messages', () => {
  it('converts Anthropic messages to OpenAI format and back', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    const result = await adapter.messages(
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      } as any,
      makeModel(),
    );

    expect(create).toHaveBeenCalledOnce();
    expect(result).toHaveProperty('type', 'message');
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('prepends system message when present', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.messages(
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'You are helpful.',
        max_tokens: 100,
      } as any,
      makeModel(),
    );

    const calledWith = create.mock.calls[0]?.[0] as { messages: { role: string }[] };
    expect(calledWith.messages[0]?.role).toBe('system');
  });
});

describe('OpenAIAdapter.getClient — fallback branches (lines 15-18)', () => {
  it('uses empty apiKey and default endpoint when model fields are undefined', async () => {
    create.mockResolvedValue({
      id: 'cmpl', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const adapter = new OpenAIAdapter();
    // apiKey=undefined → ?? '' branch; endpoint='' → || default branch; timeout=undefined → ?? 60000 branch
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] } as any,
      makeModel({ apiKey: undefined, endpoint: '' }),
    );
    // Just asserting it doesn't throw is sufficient to cover the branches
    expect(create).toHaveBeenCalled();
  });
});

describe('OpenAIAdapter callSettings (ROUT-306)', () => {
  const base: ChatCompletionRequest = { model: 'auto', messages: [{ role: 'user', content: 'Hello' }] };
  const body = () => create.mock.calls[0]?.[0] as Record<string, unknown>;

  it('without callSettings the upstream body carries no effort or verbosity', async () => {
    create.mockResolvedValue(makeResponse());
    await new OpenAIAdapter().chatCompletion(base, makeModel({ id: 'openai/gpt-5' }));
    expect(body()).not.toHaveProperty('reasoning_effort');
    expect(body()).not.toHaveProperty('verbosity');
  });

  it('empty applied settings leave the body identical to the no-settings body', async () => {
    create.mockResolvedValue(makeResponse());
    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(base, makeModel({ id: 'openai/gpt-5' }));
    await adapter.chatCompletion(base, makeModel({ id: 'openai/gpt-5' }), { callSettings: {} });
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
  });

  it('writes reasoning_effort and verbosity on chat and stream calls, even for gpt-5 (after normalization)', async () => {
    create.mockResolvedValue(makeResponse());
    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(base, makeModel({ id: 'openai/gpt-5' }), { callSettings: { effort: 'high', verbosity: 'low' } });
    expect(body()).toMatchObject({ reasoning_effort: 'high', verbosity: 'low' });

    create.mockClear();
    create.mockResolvedValue((async function* () { /* empty stream */ })());
    for await (const _ of adapter.streamCompletion(base, makeModel({ id: 'openai/gpt-5' }), { callSettings: { effort: 'medium' } })) { void _; }
    expect(body()).toMatchObject({ reasoning_effort: 'medium', stream: true });
    expect(body()).not.toHaveProperty('verbosity');
  });

  it('maxOutputTokens alone does not add effort or verbosity and does not touch the request', async () => {
    create.mockResolvedValue(makeResponse());
    const request = { ...base, max_tokens: 50 };
    const snapshot = JSON.stringify(request);
    await new OpenAIAdapter().chatCompletion(request, makeModel({ id: 'openai/gpt-5' }), { callSettings: { maxOutputTokens: 99 } });
    expect(body()).not.toHaveProperty('reasoning_effort');
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});
