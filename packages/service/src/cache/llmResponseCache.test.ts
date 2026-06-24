import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { lookupResponseCache, storeResponseCache } from './llmResponseCache.js';

// Reset module state between tests via time manipulation
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function makeVec(seed: number, dim = 10): number[] {
  // Simple deterministic unit vector
  const raw: number[] = Array.from({ length: dim }, (_, i) => (i === seed % dim ? 1 : 0));
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return raw.map(v => v / norm);
}

const RESPONSE = JSON.stringify({ id: 'r1', choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe('llmResponseCache', () => {
  it('cache miss on first call', () => {
    const hit = lookupResponseCache('proj-miss', makeVec(0), 0.95);
    expect(hit).toBeNull();
  });

  it('cache hit when similarity >= threshold (identical vector)', () => {
    const vec = makeVec(1);
    storeResponseCache('proj-hit', vec, RESPONSE, 10, 5, 60_000, 500);
    const hit = lookupResponseCache('proj-hit', vec, 0.95);
    expect(hit).not.toBeNull();
    expect(hit!.similarity).toBeCloseTo(1.0, 5);
    expect(hit!.response).toBe(RESPONSE);
    expect(hit!.promptTokens).toBe(10);
    expect(hit!.completionTokens).toBe(5);
  });

  it('cache miss when similarity < threshold (orthogonal vectors)', () => {
    const vec1 = makeVec(2);
    const vec2 = makeVec(3); // orthogonal to vec1
    storeResponseCache('proj-orth', vec1, RESPONSE, 10, 5, 60_000, 500);
    const hit = lookupResponseCache('proj-orth', vec2, 0.95);
    expect(hit).toBeNull();
  });

  it('TTL expiry: entry not returned after ttl elapses', () => {
    const vec = makeVec(4);
    storeResponseCache('proj-ttl', vec, RESPONSE, 10, 5, 1_000, 500);
    vi.advanceTimersByTime(2_000);
    const hit = lookupResponseCache('proj-ttl', vec, 0.5);
    expect(hit).toBeNull();
  });

  it('maxEntries eviction: oldest entry is dropped', () => {
    // Store maxEntries=2 entries, then a third should evict the first
    const vec0 = makeVec(5);
    const vec1 = makeVec(6);
    const vec2 = makeVec(7);
    storeResponseCache('proj-evict', vec0, RESPONSE, 1, 1, 60_000, 2);
    vi.advanceTimersByTime(10);
    storeResponseCache('proj-evict', vec1, RESPONSE, 2, 2, 60_000, 2);
    vi.advanceTimersByTime(10);
    storeResponseCache('proj-evict', vec2, RESPONSE, 3, 3, 60_000, 2);
    // vec0 should have been evicted (oldest expiresAt)
    const hit0 = lookupResponseCache('proj-evict', vec0, 0.95);
    expect(hit0).toBeNull();
    // vec1 and vec2 should still be present
    const hit1 = lookupResponseCache('proj-evict', vec1, 0.95);
    const hit2 = lookupResponseCache('proj-evict', vec2, 0.95);
    expect(hit1).not.toBeNull();
    expect(hit2).not.toBeNull();
  });
});
