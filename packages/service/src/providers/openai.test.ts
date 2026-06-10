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
});
