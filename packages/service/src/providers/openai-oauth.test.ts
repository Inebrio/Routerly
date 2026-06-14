import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIOAuthAdapter } from './openai-oauth.js';
import { OpenAIAdapter } from './openai.js';
import { getProviderAdapter } from './index.js';
import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';

const create = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  class OpenAIMock {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      this.apiKey = opts.apiKey ?? '';
      this.baseURL = opts.baseURL ?? '';
    }
    chat = { completions: { create } };
  }
  return { default: OpenAIMock };
});

afterEach(() => vi.clearAllMocks());

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o OAuth',
    provider: 'openai-oauth',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'oat-test-token',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
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

describe('OpenAIOAuthAdapter', () => {
  it('is a subclass of OpenAIAdapter', () => {
    const adapter = new OpenAIOAuthAdapter();
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });

  it('is registered under openai-oauth in the adapter registry', () => {
    const adapter = getProviderAdapter(makeModel());
    expect(adapter).toBeInstanceOf(OpenAIOAuthAdapter);
  });

  it('passes the stored token as apiKey (Bearer auth) to the SDK', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIOAuthAdapter();
    const request: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    await adapter.chatCompletion(request, makeModel({ apiKey: 'oat-my-secret-token' }));

    expect(create).toHaveBeenCalledOnce();
  });

  it('does not add Anthropic-specific headers', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIOAuthAdapter();
    const request: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    await adapter.chatCompletion(request, makeModel());

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('anthropic-beta');
    expect(calledWith).not.toHaveProperty('anthropic-dangerous-direct-browser-access');
  });
});

describe('openai-oauth regression: existing openai adapter unchanged', () => {
  it('openai adapter is still registered and independent of openai-oauth', () => {
    const adapter = getProviderAdapter(makeModel({ provider: 'openai' }));
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
    expect(adapter).not.toBeInstanceOf(OpenAIOAuthAdapter);
  });
});
