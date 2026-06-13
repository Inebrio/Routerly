import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAdapter } from './openai.js';
import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';

const create = vi.hoisted(() => vi.fn());

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

  it('strips `stream` before forwarding (forces stream: false for non-streaming call)', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], stream: true },
      makeModel(),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('stream', false);
  });

  it('normalises max_tokens → max_completion_tokens', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 512 },
      makeModel(),
    );

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('max_tokens');
    expect(calledWith).toHaveProperty('max_completion_tokens', 512);
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

  it('keeps reasoning params for o-series models', async () => {
    create.mockResolvedValue(makeResponse());
    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'o1-mini', messages: [{ role: 'user', content: 'Hi' }], reasoning_effort: 'high' } as any,
      makeModel({ id: 'o1-mini' }),
    );
    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('reasoning_effort', 'high')
    expect(calledWith).toHaveProperty('model', 'o1-mini')
  });

  it('uses model.id as-is when no slash present', async () => {
    create.mockResolvedValue(makeResponse());
    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel({ id: 'gpt-4o' }),
    );
    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).toHaveProperty('model', 'gpt-4o')
  });

  it('passes through when neither max_tokens nor max_completion_tokens are set', async () => {
    create.mockResolvedValue(makeResponse());
    const adapter = new OpenAIAdapter();
    await adapter.chatCompletion({ model: 'gpt-4o', messages: [] }, makeModel())
    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('max_tokens')
    expect(calledWith).not.toHaveProperty('max_completion_tokens')
  });
});

describe('OpenAIAdapter.streamCompletion', () => {
  it('yields chunks from the stream', async () => {
    const chunks = [{ choices: [{ delta: { content: 'hello' } }] }]
    create.mockReturnValue({ [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c } })
    const adapter = new OpenAIAdapter()
    const received: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'gpt-4o', messages: [] }, makeModel())) {
      received.push(chunk)
    }
    expect(received).toHaveLength(1)
    expect(received[0].choices[0].delta.content).toBe('hello')
  });
});

describe('OpenAIAdapter.messages', () => {
  it('converts MessagesRequest to OpenAI format and returns response', async () => {
    create.mockResolvedValue({
      id: 'cmpl-1', model: 'gpt-4o',
      choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })
    const adapter = new OpenAIAdapter()
    const result = await adapter.messages({
      model: 'gpt-4o', max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
    }, makeModel())
    expect(result.content[0]).toMatchObject({ type: 'text' })
  });

  it('includes system message when provided', async () => {
    create.mockResolvedValue({
      id: 'c2', model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })
    const adapter = new OpenAIAdapter()
    await adapter.messages({
      model: 'gpt-4o', max_tokens: 50,
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'You are helpful.',
    }, makeModel())
    const msgs = (create.mock.calls[0]![0] as any).messages
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toBe('You are helpful.')
  });

  it('uses empty string for apiKey when model.apiKey is undefined (line 15 ?? branch)', async () => {
    create.mockResolvedValueOnce({
      id: 'c-no-key', model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const adapter = new OpenAIAdapter()
    const modelNoKey: any = { ...makeModel(), apiKey: undefined }
    await adapter.chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] } as any, modelNoKey)
    expect(create).toHaveBeenCalled()
  });

  it('uses default endpoint when model.endpoint is falsy (line 18 || branch)', async () => {
    create.mockResolvedValueOnce({
      id: 'c-no-ep', model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const adapter = new OpenAIAdapter()
    const modelNoEp: any = { ...makeModel(), endpoint: '' }
    await adapter.chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] } as any, modelNoEp)
    expect(create).toHaveBeenCalled()
  });
});
