import { describe, it, expect } from 'vitest'
import { abortStrategy } from './index.js'
import type { FallbackContext, ScoredCandidate } from './types.js'

const remaining: ScoredCandidate[] = [{ model: 'top', score: 0.9 }]

describe('abortStrategy', () => {
  it('aborts even when candidates are available', () => {
    const ctx: FallbackContext = {
      failed: 'failed-model',
      remaining,
      error: new Error('boom'),
      isAvailable: () => true,
    }
    const result = abortStrategy(ctx)
    expect(result).toEqual({ kind: 'abort' })
  })

  it('aborts when no candidates are available', () => {
    const ctx: FallbackContext = {
      failed: 'failed-model',
      remaining: [],
      error: new Error('boom'),
      isAvailable: () => false,
    }
    const result = abortStrategy(ctx)
    expect(result).toEqual({ kind: 'abort' })
  })

  it('aborts when the availability seam is absent', () => {
    const ctx: FallbackContext = { failed: 'failed-model', remaining, error: new Error('boom') }
    const result = abortStrategy(ctx)
    expect(result).toEqual({ kind: 'abort' })
  })
})
