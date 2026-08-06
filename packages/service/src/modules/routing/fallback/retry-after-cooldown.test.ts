import { describe, it, expect } from 'vitest'
import { nextBestStrategy, retryAfterCooldownStrategy } from './index.js'
import type { FallbackContext, ScoredCandidate } from './types.js'

const remaining: ScoredCandidate[] = [
  { model: 'top', score: 0.9 },
  { model: 'mid', score: 0.5 },
]

describe('retryAfterCooldownStrategy', () => {
  it('always returns a cooldown action for the failed model, regardless of the availability seam', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining, error: new Error('boom') }
    const result = retryAfterCooldownStrategy(ctx)
    expect(result).toEqual({ kind: 'cooldown', model: 'failed-model', ms: 2000 })
  })

  it('returns the same cooldown action even when remaining is empty', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining: [], error: new Error('boom') }
    const result = retryAfterCooldownStrategy(ctx)
    expect(result).toEqual({ kind: 'cooldown', model: 'failed-model', ms: 2000 })
  })

  it('ignores the isAvailable seam even when every remaining candidate is unavailable', () => {
    const ctx: FallbackContext = {
      failed: 'failed-model',
      remaining,
      error: new Error('boom'),
      isAvailable: () => false,
    }
    const result = retryAfterCooldownStrategy(ctx)
    expect(result).toEqual({ kind: 'cooldown', model: 'failed-model', ms: 2000 })
  })

  it('is stateless: calling it repeatedly with the same context always returns cooldown, never escalates on its own', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining, error: new Error('boom') }
    expect(retryAfterCooldownStrategy(ctx)).toEqual({ kind: 'cooldown', model: 'failed-model', ms: 2000 })
    expect(retryAfterCooldownStrategy(ctx)).toEqual({ kind: 'cooldown', model: 'failed-model', ms: 2000 })
  })

  // Two-call caller-orchestrated sequence: the future retry loop is responsible for tracking
  // "did this model already get a cooldown" and choosing nextBestStrategy on the next failure.
  it('cooldown-then-next-best is caller-orchestrated: cooldown on first call, next-best on a following call', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining, error: new Error('boom') }

    const firstCall = retryAfterCooldownStrategy(ctx)
    expect(firstCall).toEqual({ kind: 'cooldown', model: 'failed-model', ms: 2000 })

    const followingCall = nextBestStrategy(ctx)
    expect(followingCall).toEqual({ kind: 'try', model: 'top' })
  })
})
