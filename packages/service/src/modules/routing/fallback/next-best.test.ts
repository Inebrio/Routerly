import { describe, it, expect } from 'vitest'
import { nextBestStrategy } from './index.js'
import type { FallbackContext, ScoredCandidate } from './types.js'

const remaining: ScoredCandidate[] = [
  { model: 'top', score: 0.9 },
  { model: 'mid', score: 0.5 },
  { model: 'low', score: 0.1 },
]

describe('nextBestStrategy', () => {
  it('tries the highest-ranked remaining candidate when no availability seam is present', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining, error: new Error('boom') }
    const result = nextBestStrategy(ctx)
    expect(result).toEqual({ kind: 'try', model: 'top' })
  })

  it('skips candidates that fail the availability seam and tries the first available one', () => {
    const ctx: FallbackContext = {
      failed: 'failed-model',
      remaining,
      error: new Error('boom'),
      isAvailable: (modelId) => modelId === 'mid',
    }
    const result = nextBestStrategy(ctx)
    expect(result).toEqual({ kind: 'try', model: 'mid' })
  })

  it('aborts when no remaining candidate passes the availability seam', () => {
    const ctx: FallbackContext = {
      failed: 'failed-model',
      remaining,
      error: new Error('boom'),
      isAvailable: () => false,
    }
    const result = nextBestStrategy(ctx)
    expect(result).toEqual({ kind: 'abort' })
  })

  it('aborts when remaining is empty', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining: [], error: new Error('boom') }
    const result = nextBestStrategy(ctx)
    expect(result).toEqual({ kind: 'abort' })
  })
})
