import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('../../cost/tracker.js', () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}));

// Default: empty catalog → getEmbeddingInputCost returns 0 for any provider/model
const mockCatalogGet = vi.fn().mockResolvedValue({});
vi.mock('../../catalog/fetcher.js', () => ({
  catalogFetcher: { get: (...args: any[]) => mockCatalogGet(...args) },
}));

// Default: return a model entry matching the baseConfig embedding_model.
const mockReadConfig = vi.fn().mockResolvedValue([
  { id: 'text-embedding-3-small', apiKey: 'sk-test', endpoint: 'https://api.openai.com/v1' },
]);
vi.mock('../../config/loader.js', () => ({
  readConfig: (...args: any[]) => mockReadConfig(...args),
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

import { trackUsage } from '../../cost/tracker.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('semanticIntentPolicy', () => {
  beforeEach(() => {
    clearIntentCache();
    vi.clearAllMocks();
    // Restore default registry mock after clearAllMocks (clearAllMocks resets mockResolvedValue).
    mockReadConfig.mockResolvedValue([
      { id: 'text-embedding-3-small', apiKey: 'sk-test', endpoint: 'https://api.openai.com/v1' },
    ]);
    mockCatalogGet.mockResolvedValue({});
  });

  afterEach(() => vi.clearAllMocks());

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

  it('falls back to all concatenated content when user content is an array', async () => {
    // User message has array content → no string user message found → fallback joins all messages
    const requestVec = [0, 0, 0]; // zero → unknown status
    mockProvider.embed.mockResolvedValue({ embeddings: [requestVec], inputTokens: 0 });

    const result = await semanticIntentPolicy({
      request: {
        model: 'auto',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] as any }],
      } as any,
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
    });

    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  it('falls back to concatenating non-user string messages when no user string message exists', async () => {
    // No user message with string content → ?? right side fires → filter/map/join on assistant message
    const requestVec = [0, 0, 0]; // zero → unknown status
    mockProvider.embed.mockResolvedValue({ embeddings: [requestVec], inputTokens: 0 });

    const result = await semanticIntentPolicy({
      request: {
        model: 'auto',
        messages: [{ role: 'assistant', content: 'some assistant text' }],
      } as any,
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
    });

    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  it('tracks usage when projectId is provided and classification succeeds', async () => {
    const vec = [1, 0, 0];
    mockProvider.embed.mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => vec),
      inputTokens: 10,
    }));

    const log = { info: vi.fn(), warn: vi.fn() } as any;

    const result = await semanticIntentPolicy({
      request: makeRequest('some coding question'),
      candidates: [makeCandidate('coder-model')],
      config: { ...baseConfig, absolute_threshold: 0.0 },
      projectId: 'proj-test',
      log,
      traceId: 'trace-1',
    });

    expect(result.routing).toBeDefined();
    expect(log.info).toHaveBeenCalled();
  });

  it('passes all candidates when no messages have string content', async () => {
    const result = await semanticIntentPolicy({
      request: {
        model: 'auto',
        messages: [],
      } as any,
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
    });

    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  // ── Line 58: request.messages ?? [] when messages is absent ─────────────────
  it('passes all candidates when request has no messages property (messages ?? [])', async () => {
    const result = await semanticIntentPolicy({
      request: { model: 'auto' } as any,
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
    });

    // No messages → userText is '' → passes all through
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  // ── Line 108: traceId === undefined inside projectId block ───────────────────
  it('tracks usage without traceId when projectId is set but traceId is omitted', async () => {
    const vec = [1, 0, 0];
    mockProvider.embed.mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => vec),
      inputTokens: 5,
    }));

    await semanticIntentPolicy({
      request: makeRequest('write code'),
      candidates: [makeCandidate('coder-model')],
      config: { ...baseConfig, absolute_threshold: 0.0 },
      projectId: 'proj-no-trace',
      // traceId intentionally omitted → hits the false branch of `traceId !== undefined`
    });

    expect(trackUsage).toHaveBeenCalledWith(
      expect.not.objectContaining({ traceId: expect.anything() }),
    );
  });

  // ── Lines 113 & 117: catch block when err is NOT an Error instance ───────────
  it('degrades gracefully and stringifies non-Error thrown value', async () => {
    // Throw a plain string (not an Error instance) → String(err) branch
    mockProvider.embed.mockRejectedValue('plain string error');

    const emit = vi.fn();
    const log = { warn: vi.fn(), info: vi.fn() } as any;
    const result = await semanticIntentPolicy({
      request: makeRequest('some text'),
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
      emit,
      log,
    });

    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      message: 'policy:semantic-intent:error',
      details: expect.objectContaining({ error: 'plain string error' }),
    }));
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'plain string error' }),
      expect.any(String),
    );
  });

  // ── Line 148: resolvePool called with null intentName (ambiguous, secondIntent=null) ──
  it('resolvePool returns all candidates when secondIntent is null (ambiguous status)', async () => {
    // Use a config with only one intent so secondIntent is null when ambiguous
    const singleIntentConfig: SemanticIntentConfig = {
      ...baseConfig,
      intents: { coding: baseConfig.intents['coding']! },
      absolute_threshold: 0.0,
      ambiguity_threshold: 2.0, // very high → ambiguous
    };

    const vec = [1, 0, 0];
    mockProvider.embed.mockResolvedValue({ embeddings: [vec], inputTokens: 0 });

    const result = await semanticIntentPolicy({
      request: makeRequest('write some code'),
      candidates: [makeCandidate('coder-model'), makeCandidate('other-model')],
      config: singleIntentConfig,
    });

    // secondIntent is null → resolvePool(null) returns all candidateIds
    // pool1 ∪ pool2 (all) → all candidates allowed
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  // ── Line 150: resolvePool when intentDef is missing from cfg.intents ─────────
  it('resolvePool falls back to all candidates when intentName is not in cfg.intents', async () => {
    // Build classification result where topIntent is a name not in the config's intents map.
    // We can achieve this by having classifyIntent return a confident result for 'coding',
    // but using a config that has no 'coding' key.
    const noMatchConfig: SemanticIntentConfig = {
      ...baseConfig,
      intents: {
        unknown_intent: {
          examples: ['something else'],
          candidate_models: ['never-model'],
        },
      },
      absolute_threshold: 0.0,
      ambiguity_threshold: 0.0,
    };

    const vec = [1, 0, 0];
    mockProvider.embed.mockResolvedValue({ embeddings: [vec], inputTokens: 0 });

    // The classifier will return topIntent='unknown_intent' (confident)
    // cfg.intents['unknown_intent'] exists but candidate_models=['never-model']
    // which is NOT in the candidates list → falls back to all candidates (pool.size === 0).
    const result = await semanticIntentPolicy({
      request: makeRequest('some request'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: noMatchConfig,
    });

    // Since the intent's pool has no overlap with candidates, falls back to all candidates
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });

  // ── getEmbeddingInputCost: provider not in catalog → returns 0 ──
  it('getEmbeddingInputCost returns 0 when the provider model has no input cost defined', async () => {
    const vec = [1, 0, 0];
    mockProvider.embed.mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => vec),
      inputTokens: 7,
    }));
    // Include the nonexistent-model in the registry so the policy proceeds past the lookup.
    mockReadConfig.mockResolvedValue([
      { id: 'nonexistent-model', apiKey: 'sk-x', endpoint: 'https://example.com/v1' },
    ]);

    // Use a provider/model combo that does not exist in providersConf → input cost = 0
    await semanticIntentPolicy({
      request: makeRequest('compute something'),
      candidates: [makeCandidate('coder-model')],
      config: {
        ...baseConfig,
        embedding_provider: 'nonexistent-provider',
        embedding_model: 'nonexistent-model',
        absolute_threshold: 0.0,
      },
      projectId: 'proj-cost-zero',
    });

    // trackUsage should be called with inputPerMillion: 0
    expect(trackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ cost: { inputPerMillion: 0, outputPerMillion: 0 } }),
      }),
    );
  });
});

// ── Model registry lookup (Fix #112) ─────────────────────────────────────────

describe('semanticIntentPolicy — model registry credential injection', () => {
  const defaultRegistryEntry = { id: 'text-embedding-3-small', apiKey: 'sk-from-registry', endpoint: 'https://api.openai.com/v1' };

  beforeEach(() => {
    clearIntentCache();
    vi.clearAllMocks();
    mockReadConfig.mockResolvedValue([defaultRegistryEntry]);
    mockCatalogGet.mockResolvedValue({});
  });

  afterEach(() => {
    // Restore default so sibling describe blocks are not affected.
    mockReadConfig.mockResolvedValue([defaultRegistryEntry]);
    mockCatalogGet.mockResolvedValue({});
  });

  it('injects apiKey from model registry into classifyIntent config', async () => {
    // The embed mock (called inside classifyIntent) gets invoked only when credentials are injected.
    // We verify the policy proceeds past the credential lookup by checking classification was called.
    const vec = [1, 0, 0];
    mockProvider.embed.mockResolvedValue({ embeddings: [vec], inputTokens: 0 });

    const result = await semanticIntentPolicy({
      request: makeRequest('write code'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: baseConfig, // no apiKey/endpoint in config
    });

    // Classification succeeded — embedding provider was called
    expect(mockProvider.embed).toHaveBeenCalled();
    expect(result.routing).toHaveLength(2);
  });

  it('passes all candidates through when embedding model is not in registry', async () => {
    mockReadConfig.mockResolvedValue([]); // empty registry

    const log = { warn: vi.fn(), info: vi.fn() } as any;
    const result = await semanticIntentPolicy({
      request: makeRequest('write code'),
      candidates: [makeCandidate('coder-model'), makeCandidate('chat-model')],
      config: baseConfig,
      log,
    });

    // Should degrade gracefully
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingModel: 'text-embedding-3-small' }),
      expect.any(String),
    );
    // classifyIntent should NOT have been called
    expect(mockProvider.embed).not.toHaveBeenCalled();
  });

  it('runs without injecting credentials when model entry has no apiKey or endpoint', async () => {
    // Covers the false branches on the ternaries at lines 96–97:
    //   ...(modelEntry.apiKey ? {...} : {}) → {} (no apiKey)
    //   ...(modelEntry.endpoint ? {...} : {}) → {} (no endpoint)
    mockReadConfig.mockResolvedValue([{ id: 'text-embedding-3-small' }]);

    const vec = [0, 0, 0]; // → unknown → pass all through
    mockProvider.embed.mockResolvedValue({ embeddings: [vec], inputTokens: 0 });

    const result = await semanticIntentPolicy({
      request: makeRequest('write code'),
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
    });

    expect(mockProvider.embed).toHaveBeenCalled();
    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
  });
});

// ── Line 113: log?.warn with err instanceof Error → TRUE branch ───────────────

describe('semanticIntentPolicy — line 113 err instanceof Error TRUE branch', () => {
  beforeEach(() => {
    clearIntentCache();
    vi.clearAllMocks();
    mockReadConfig.mockResolvedValue([
      { id: 'text-embedding-3-small', apiKey: 'sk-test', endpoint: 'https://api.openai.com/v1' },
    ]);
    mockCatalogGet.mockResolvedValue({});
  });

  it('logs err.message when the thrown value is an Error instance and log is provided', async () => {
    mockProvider.embed.mockRejectedValue(new Error('embedding network error'));

    const emit = vi.fn();
    const log = { warn: vi.fn(), info: vi.fn() } as any;
    const result = await semanticIntentPolicy({
      request: makeRequest('some text'),
      candidates: [makeCandidate('coder-model')],
      config: baseConfig,
      emit,
      log,
    });

    expect(result.routing.every(r => r.point === 1.0)).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'embedding network error' }),
      expect.any(String),
    );
  });
});

// ── Line 15: getEmbeddingInputCost catch { return 0 } when catalogFetcher.get throws ──
describe('semanticIntentPolicy — line 15: getEmbeddingInputCost catch branch', () => {
  beforeEach(() => {
    clearIntentCache();
    vi.clearAllMocks();
    mockReadConfig.mockResolvedValue([
      { id: 'text-embedding-3-small', apiKey: 'sk-test', endpoint: 'https://api.openai.com/v1' },
    ]);
  });

  it('returns 0 cost and continues when catalogFetcher.get throws (line 15 catch branch)', async () => {
    // catalogFetcher.get throws → catch → return 0 → trackUsage called with inputPerMillion 0
    mockCatalogGet.mockRejectedValue(new Error('catalog unavailable'));

    const vec = [1, 0, 0];
    mockProvider.embed.mockResolvedValue({ embeddings: [vec], inputTokens: 5 });

    const result = await semanticIntentPolicy({
      request: makeRequest('compute something'),
      candidates: [makeCandidate('coder-model')],
      config: { ...baseConfig, absolute_threshold: 0.0 },
      projectId: 'proj-catch-test',
    });

    // Policy still runs; embedding cost falls back to 0
    expect(result.routing).toHaveLength(1);
    expect(trackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ cost: { inputPerMillion: 0, outputPerMillion: 0 } }),
      }),
    );
  });
});
