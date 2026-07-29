import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filterAvailable } from './filter.js';
import { InMemoryResilienceStore } from './store.js';
import type { CandidateModel } from '../routing/policies/types.js';
import type { ModelConfig, ResilienceKey, ResilienceStore } from '@routerly/shared';

function makeModel(id: string, provider: ModelConfig['provider'] = 'openai'): ModelConfig {
  return {
    id,
    name: id,
    provider,
    endpoint: `https://api.${provider}.com/v1`,
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  };
}

function candidate(id: string, provider: ModelConfig['provider'] = 'openai'): CandidateModel {
  return { model: makeModel(id, provider) };
}

describe('filterAvailable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns every candidate as available when nothing has faulted', () => {
    const store = new InMemoryResilienceStore();
    const candidates = [candidate('m1'), candidate('m2')];

    const result = filterAvailable(candidates, store);

    expect(result.available).toEqual(candidates);
    expect(result.excluded).toEqual([]);
  });

  it('excludes a candidate whose provider circuit is open', () => {
    const store = new InMemoryResilienceStore();
    for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'openai' }, { category: 'server' });

    const a = candidate('m1', 'openai');
    const b = candidate('m2', 'anthropic');
    const result = filterAvailable([a, b], store);

    expect(result.available).toEqual([b]);
    expect(result.excluded).toEqual([{ modelId: 'm1', level: 'provider', until: expect.any(Number) }]);
  });

  it('excludes a candidate whose model is locked out', () => {
    const store = new InMemoryResilienceStore();
    store.record({ level: 'model', id: 'locked-model' }, { category: 'content-safety' });

    const a = candidate('locked-model');
    const b = candidate('fine-model');
    const result = filterAvailable([a, b], store);

    expect(result.available).toEqual([b]);
    expect(result.excluded).toEqual([{ modelId: 'locked-model', level: 'model', until: expect.any(Number) }]);
  });

  it('excludes a candidate whose connection is cooling down', () => {
    const store = new InMemoryResilienceStore();
    store.record({ level: 'connection', id: 'openai' }, { category: 'rate-limit', retryAfterMs: 30_000 });

    const a = candidate('m1', 'openai');
    const b = candidate('m2', 'anthropic');
    const result = filterAvailable([a, b], store);

    expect(result.available).toEqual([b]);
    expect(result.excluded).toEqual([{ modelId: 'm1', level: 'connection', until: expect.any(Number) }]);
  });

  it('grants the single half-open probe to only the first candidate sharing a recovered provider key', () => {
    const store = new InMemoryResilienceStore();
    for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'openai' }, { category: 'server' });
    vi.advanceTimersByTime(60_000); // provider circuit eligible for half-open probe

    const a = candidate('m1', 'openai');
    const b = candidate('m2', 'openai');
    const result = filterAvailable([a, b], store);

    // First candidate consumes the single atomic probe; the second finds the breaker half-open
    // with the probe already in flight and is excluded.
    expect(result.available).toEqual([a]);
    expect(result.excluded).toEqual([{ modelId: 'm2', level: 'provider', until: expect.any(Number) }]);
  });

  it('never calls tryProbe on a key that is already available', () => {
    const store = new InMemoryResilienceStore();
    const spy = vi.spyOn(store, 'tryProbe');

    filterAvailable([candidate('m1')], store);

    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to the single nearest-to-recover candidate when every candidate is excluded', () => {
    const store = new InMemoryResilienceStore();
    // Connection cooldown recovers sooner than the model lockout.
    store.record({ level: 'connection', id: 'openai' }, { category: 'rate-limit', retryAfterMs: 10_000 });
    store.record({ level: 'model', id: 'model-b' }, { category: 'content-safety' }); // 5 min lockout

    const a: CandidateModel = { model: makeModel('model-a', 'openai') };
    const b: CandidateModel = { model: makeModel('model-b', 'anthropic') };
    const result = filterAvailable([a, b], store);

    expect(result.available).toEqual([a]); // never empty
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded.map(e => e.modelId).sort()).toEqual(['model-a', 'model-b']);
  });

  it('tie-breaks the fallback alphabetically by model.id when recovery timestamps are equal', () => {
    const store = new InMemoryResilienceStore();
    store.record({ level: 'connection', id: 'openai' }, { category: 'rate-limit', retryAfterMs: 10_000 });
    store.record({ level: 'connection', id: 'anthropic' }, { category: 'rate-limit', retryAfterMs: 10_000 });

    const zeta: CandidateModel = { model: makeModel('model-z', 'openai') };
    const alpha: CandidateModel = { model: makeModel('model-a', 'anthropic') };
    const result = filterAvailable([zeta, alpha], store);

    expect(result.available).toEqual([alpha]);
  });

  it('tie-breaks by model.id when an excluded candidate has no recorded timestamp at all (defensive)', () => {
    // A minimal fake store that reports every key as unavailable/unprobeable with no
    // snapshot entries — exercises the defensive fallback the brief calls out, since the
    // real InMemoryResilienceStore always sets openedAt alongside 'open'.
    const fakeStore: ResilienceStore = {
      record: () => {},
      recordSuccess: () => {},
      snapshot: () => ({ entries: [], generatedAt: Date.now() }),
      isAvailable: (_key: ResilienceKey) => false,
      tryProbe: (_key: ResilienceKey) => false,
      reset: () => {},
    };

    const zeta: CandidateModel = { model: makeModel('model-z') };
    const alpha: CandidateModel = { model: makeModel('model-a') };
    const result = filterAvailable([zeta, alpha], fakeStore);

    expect(result.available).toEqual([alpha]);
    expect(result.excluded.every(e => e.until === undefined)).toBe(true);
  });
});
