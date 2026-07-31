import { describe, it, expect } from 'vitest';
import type { ModelConfig, ResilienceFault, ResilienceKey } from '@routerly/shared';
import { recordFault } from './record.js';
import { classifyUpstreamError } from './classifier.js';

const model: ModelConfig = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  cost: { inputPerMillion: 0, outputPerMillion: 0 },
};

/** Minimal capturing store: records the (key, fault) pairs recordFault routes to it. */
function capture() {
  const records: Array<{ key: ResilienceKey; fault: ResilienceFault }> = [];
  return {
    records,
    record(key: ResilienceKey, fault: ResilienceFault) { records.push({ key, fault }); },
    recordSuccess() {},
    isAvailable() { return true; },
    tryProbe() { return true; },
    snapshot() { return { entries: [], generatedAt: Date.now() }; },
    reset() {},
  };
}

describe('recordFault — category→level mapping (single authority)', () => {
  it('routes a 404 (model-not-found) to the MODEL key — never the provider', () => {
    const store = capture();
    recordFault(store, model, classifyUpstreamError(new Error('nope'), { status: 404 }));
    expect(store.records).toHaveLength(1);
    expect(store.records[0]!.key).toEqual({ level: 'model', id: 'gpt-4o' });
    expect(store.records[0]!.fault.category).toBe('model-not-found');
  });

  it('routes content-safety to the MODEL key', () => {
    const store = capture();
    recordFault(store, model, classifyUpstreamError(new Error('refused'), { status: 400, body: { error: { type: 'content_policy_violation' } } }));
    expect(store.records[0]!.key).toEqual({ level: 'model', id: 'gpt-4o' });
    expect(store.records[0]!.fault.category).toBe('content-safety');
  });

  it('routes a 429 (rate-limit) to the CONNECTION key', () => {
    const store = capture();
    recordFault(store, model, classifyUpstreamError(new Error('429'), { status: 429 }));
    expect(store.records[0]!.key).toEqual({ level: 'connection', id: 'openai' });
    expect(store.records[0]!.fault.category).toBe('rate-limit');
  });

  it('routes a 500 (server) to the PROVIDER key', () => {
    const store = capture();
    recordFault(store, model, classifyUpstreamError(new Error('boom'), { status: 500 }));
    expect(store.records[0]!.key).toEqual({ level: 'provider', id: 'openai' });
    expect(store.records[0]!.fault.category).toBe('server');
  });

  it('no-ops safely when the store is undefined (resilience module not bootstrapped)', () => {
    expect(() => recordFault(undefined, model, { category: 'server' })).not.toThrow();
  });
});
