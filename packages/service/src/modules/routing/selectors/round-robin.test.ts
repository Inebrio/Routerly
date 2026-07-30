import { describe, it, expect } from 'vitest'
import { roundRobinSelector } from './index.js'
import type { ScoredCandidate, SelectorContext } from './types.js'

function ctx(projectId: string, overrides: Partial<SelectorContext> = {}): SelectorContext {
  return { projectId, allAbstained: false, ...overrides }
}

describe('roundRobinSelector', () => {
  it('returns empty result for no candidates', () => {
    const result = roundRobinSelector([], ctx('proj-rr-empty'))
    expect(result).toEqual({ models: [], trace: [] })
  })

  it('orders candidates deterministically by model id before picking', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'zebra', score: 0.9 },
      { model: 'alpha', score: 0.1 },
      { model: 'mid', score: 0.5 },
    ]
    // sorted by id: alpha, mid, zebra; first call to a fresh key starts at cursor 0
    const result = roundRobinSelector(candidates, ctx('proj-rr-order'))
    expect(result.models[0]!.model).toBe('alpha')
    expect(result.models.slice(1).map(m => m.model)).toEqual(['mid', 'zebra'])
  })

  it('advances the cursor across successive calls with the same projectId', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
      { model: 'c', score: 0.5 },
    ]
    const key = 'proj-rr-advance'
    const picks = [
      roundRobinSelector(candidates, ctx(key)).models[0]!.model,
      roundRobinSelector(candidates, ctx(key)).models[0]!.model,
      roundRobinSelector(candidates, ctx(key)).models[0]!.model,
      roundRobinSelector(candidates, ctx(key)).models[0]!.model,
    ]
    expect(picks).toEqual(['a', 'b', 'c', 'a'])
  })

  it('keeps independent cursors per projectId', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
    ]
    const first = roundRobinSelector(candidates, ctx('proj-rr-x')).models[0]!.model
    const second = roundRobinSelector(candidates, ctx('proj-rr-y')).models[0]!.model
    expect(first).toBe('a')
    expect(second).toBe('a')
  })

  it('single candidate always picked (modulo=1)', () => {
    const result = roundRobinSelector([{ model: 'solo', score: 0.5 }], ctx('proj-rr-solo'))
    expect(result.models).toEqual([{ model: 'solo', weight: 1 }])
  })
})
