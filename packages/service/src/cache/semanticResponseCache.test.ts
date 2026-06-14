import { describe, it, expect } from 'vitest'
import { lookupCache, storeCache } from './semanticResponseCache.js'

describe('semanticResponseCache', () => {
  it('returns null when no entries for project', () => {
    const result = lookupCache('proj-empty', [1, 0], 0.9)
    expect(result).toBeNull()
  })

  it('stores and retrieves a matching entry', () => {
    storeCache('proj-1', [1, 0, 0], 'model-a', 60_000)
    const result = lookupCache('proj-1', [1, 0, 0], 0.99)
    expect(result).not.toBeNull()
    expect(result!.modelId).toBe('model-a')
    expect(result!.similarity).toBeCloseTo(1.0, 4)
  })

  it('returns null when similarity is below threshold', () => {
    storeCache('proj-2', [1, 0, 0], 'model-b', 60_000)
    const result = lookupCache('proj-2', [0, 1, 0], 0.99) // orthogonal → sim=0
    expect(result).toBeNull()
  })

  it('returns best matching entry above threshold', () => {
    storeCache('proj-3', [0.8, 0.2, 0], 'model-low', 60_000)
    storeCache('proj-3', [0.9, 0.1, 0], 'model-high', 60_000)
    // Query closer to model-high
    const result = lookupCache('proj-3', [0.95, 0.05, 0], 0.5)
    expect(result).not.toBeNull()
    expect(result!.modelId).toBe('model-high')
  })

  it('returns null when all entries are expired (lazy pruning)', () => {
    storeCache('proj-expired', [1, 0], 'model-x', -1) // TTL of -1ms → already expired
    const result = lookupCache('proj-expired', [1, 0], 0.5)
    expect(result).toBeNull()
  })

  it('prunes expired entries on lookup', () => {
    storeCache('proj-prune', [1, 0, 0], 'expired', -1)
    storeCache('proj-prune', [0, 1, 0], 'live', 60_000)
    // This lookup should prune the expired entry
    const result = lookupCache('proj-prune', [0, 1, 0], 0.99)
    expect(result!.modelId).toBe('live')
  })

  it('extends TTL when extendTtlMs is provided on cache hit', () => {
    const ttl = 60_000
    storeCache('proj-extend', [1, 0], 'model-ext', ttl)
    const before = Date.now()
    const result = lookupCache('proj-extend', [1, 0], 0.99, ttl)
    expect(result).not.toBeNull()
    // After lookup with extendTtlMs, a second lookup should still return the entry
    const result2 = lookupCache('proj-extend', [1, 0], 0.99)
    expect(result2).not.toBeNull()
    expect(result2!.modelId).toBe('model-ext')
  })

  it('does not modify expiry when no hit within threshold', () => {
    storeCache('proj-no-extend', [1, 0], 'model', 60_000)
    // Query far away → no hit
    lookupCache('proj-no-extend', [0, 1], 0.99, 60_000)
    // Original entry should still be accessible with matching vector
    const result = lookupCache('proj-no-extend', [1, 0], 0.99)
    expect(result).not.toBeNull()
  })

  it('isolates storage by projectId', () => {
    storeCache('proj-a', [1, 0], 'model-for-a', 60_000)
    storeCache('proj-b', [1, 0], 'model-for-b', 60_000)
    expect(lookupCache('proj-a', [1, 0], 0.99)!.modelId).toBe('model-for-a')
    expect(lookupCache('proj-b', [1, 0], 0.99)!.modelId).toBe('model-for-b')
  })

  it('returns null when entries list is empty after pruning', () => {
    storeCache('proj-all-expired', [1, 0], 'm', -1)
    // First call prunes the entry
    lookupCache('proj-all-expired', [1, 0], 0.5)
    // Second call should return null gracefully
    const result = lookupCache('proj-all-expired', [1, 0], 0.5)
    expect(result).toBeNull()
  })
})
