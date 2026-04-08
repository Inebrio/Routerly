import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearIntentCache } from '../intent/cache.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockProvider(vectors: Record<string, number[]>) {
  return {
    embed: vi.fn(async (texts: string[], _model: string) => ({
      embeddings: texts.map(t => vectors[t] ?? [0]),
      inputTokens: 0,
    })),
  };
}

// Mock the embedding index so we can inject a fake provider.
const mockProvider = makeMockProvider({});
vi.mock('../../embeddings/index.js', () => ({
  getEmbeddingProvider: vi.fn(() => mockProvider),
}));

import { semanticIntentPolicy } from './semantic-intent.js';
import type { PolicyInput } from './types.js';
import type { SemanticIntentConfig } from '@routerly/shared';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRequest(content: string): PolicyInput['request'] {
  return {
    model: 'auto',
    messages: [{ role: 'user', content }],
  } as PolicyInput['request'];
}

function makeCandidate(id: string): PolicyInput['candidates'][0] {
  return {
    model: {
      id,
      name: id,
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: { inputPerMillion: 1, outputPerMillion: 3 },
    },
  };
}

const baseConfig: SemanticIntentConfig = {
  embedding_provider: 'openai',
  embedding_model: 'text-embedding-3-small',
  absolute_threshold: 0.60,
  ambiguity_threshold: 0.08,
  intents: {
    coding: {
      examples: ['write a python function', 'fix this typescript bug'],
      candidate_models: ['coder-model'],
    },
    general_chat: {
      examples: ['hello', 'how are you'],
      candidate_models: ['chat-model'],
    },
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('semanticIntentPolicy', () => {
  beforeEach(() => {
    clearIntentCache();
    vi.clearAllMocks();
  });

  it('passes all candidates when config is missing required fields', async () => {
    const emitMock = vi.fn();
    const result = await semanticIntentPolicy({
      request: makeRequest('hello'),
      candidates: [makeCandidate('any-model')],
      config: {},
      emit: emitMock,
    });

    expect(result.routing).toHaveLength(1);
    expect(result.routing[0]!.point).toBe(1.0);
    expect(emitMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'policy:semantic-intent:misconfigured',
    }));
  });

  it('passes all candidates when status is unknown (low score)', async () => {
    // All similarities will be 0 (zero vectors) → below absolute_threshold → unknown
    mockProvider.embed.mockResolvedValue({ embeddings: [[0, 0, 0]], inputTokens: 0 });

    // Centroids also zero → cosineSimilarity = 0
    const result = await semanticIntentPolicy({
      request: makeRequest('some text'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: baseConfig,
    });

    expect(result.excludes).toBeUndefined();
    expect(result.routing).toHaveLength(2);
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  it('filters to intent pool when status is confident', async () => {
    // coding intent examples → centroid ~[1,0,0]
    // general_chat examples → centroid ~[0,1,0]
    // request → [1,0,0] close to coding
    const codingVec = [1, 0, 0];
    const chatVec = [0, 1, 0];
    const requestVec = [0.99, 0.01, 0];

    mockProvider.embed.mockImplementation(async (texts: string[]) => {
      return {
        embeddings: texts.map(t => {
          if (t === 'some text') return requestVec;
          if ((baseConfig.intents['coding']?.examples ?? []).includes(t)) return codingVec;
          return chatVec;
        }),
        inputTokens: 0,
      };
    });

    const result = await semanticIntentPolicy({
      request: makeRequest('some text'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model'), makeCandidate('other-model')],
      config: baseConfig,
    });

    // coder-model is in coding pool → included
    const coderEntry = result.routing.find(r => r.model === 'coder-model');
    expect(coderEntry?.point).toBe(1.0);

    // chat-model is not in coding pool → excluded
    const chatEntry = result.routing.find(r => r.model === 'chat-model');
    expect(chatEntry?.point).toBe(0.0);
    expect(result.excludes).toContain('chat-model');
  });

  it('merges pools when status is ambiguous', async () => {
    // Two intents with similar scores (margin < ambiguity_threshold)
    const vec = [1, 0, 0]; // same vector for all → margin = 0

    mockProvider.embed.mockResolvedValue({ embeddings: [vec], inputTokens: 0 });

    const result = await semanticIntentPolicy({
      request: makeRequest('ambiguous text'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: {
        ...baseConfig,
        absolute_threshold: 0.0, // ensure score passes absolute threshold
        ambiguity_threshold: 1.0, // very high → everything is ambiguous
      },
    });

    // Both pools merged → both models allowed
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
    expect(result.excludes).toBeUndefined();
  });

  it('passes all candidates when user message is empty', async () => {
    const result = await semanticIntentPolicy({
      request: makeRequest('   '),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: baseConfig,
    });

    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
    expect(result.excludes).toBeUndefined();
  });

  it('degrades gracefully when the embedding provider throws', async () => {
    mockProvider.embed.mockRejectedValue(new Error('network error'));

    const emit = vi.fn();
    const result = await semanticIntentPolicy({
      request: makeRequest('some text'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: baseConfig,
      emit,
    });

    // All candidates pass through
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
    // An error trace entry is emitted
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      message: 'policy:semantic-intent:error',
    }));
  });

  it('falls back to all candidates when intent pool has no overlap with project candidates', async () => {
    const codingVec = [1, 0, 0];
    const requestVec = [0.99, 0, 0];

    mockProvider.embed.mockImplementation(async (texts: string[]) => {
      return {
        embeddings: texts.map(t => {
          if (t === 'some text') return requestVec;
          return codingVec;
        }),
        inputTokens: 0,
      };
    });

    // Project candidates don't include any model from the coding pool
    const result = await semanticIntentPolicy({
      request: makeRequest('some text'),
      candidates: [makeCandidate('some-other-model')],
      config: baseConfig,
    });

    // Falls back to all candidates
    expect(result.routing.find(r => r.model === 'some-other-model')?.point).toBe(1.0);
  });
});
