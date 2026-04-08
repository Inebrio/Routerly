import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIEmbeddingProvider } from './openai.js';

// Mock the OpenAI SDK.
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  const MockOpenAI = vi.fn(() => ({
    embeddings: { create: mockCreate },
  }));
  (MockOpenAI as any).__mockCreate = mockCreate;
  return { default: MockOpenAI };
});

import OpenAI from 'openai';

function getMockCreate() {
  return (OpenAI as any).__mockCreate as ReturnType<typeof vi.fn>;
}

describe('OpenAIEmbeddingProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls embeddings.create with the correct parameters', async () => {
    const mockVec = [0.1, 0.2, 0.3];
    getMockCreate().mockResolvedValue({
      data: [{ embedding: mockVec }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    });

    const provider = new OpenAIEmbeddingProvider();
    const result = await provider.embed(['hello world'], 'text-embedding-3-small');

    expect(getMockCreate()).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['hello world'],
      encoding_format: 'float',
    });
    expect(result.embeddings).toEqual([mockVec]);
    expect(result.inputTokens).toBe(3);
  });

  it('returns one vector per input text', async () => {
    getMockCreate().mockResolvedValue({
      data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    });

    const provider = new OpenAIEmbeddingProvider();
    const result = await provider.embed(['text1', 'text2'], 'text-embedding-3-small');

    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toEqual([1, 0]);
    expect(result.embeddings[1]).toEqual([0, 1]);
    expect(result.inputTokens).toBe(2);
  });

  it('propagates errors from the SDK', async () => {
    getMockCreate().mockRejectedValue(new Error('api error'));

    const provider = new OpenAIEmbeddingProvider();
    await expect(provider.embed(['test'], 'model')).rejects.toThrow('api error');
  });
});
