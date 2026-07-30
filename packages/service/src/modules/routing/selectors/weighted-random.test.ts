import { describe, it, expect } from 'vitest'
import { weightedRandomSelector } from './index.js'
import type { ScoredCandidate, SelectorContext } from './types.js'

function ctx(overrides: Partial<SelectorContext> = {}): SelectorContext {
  return { projectId: 'proj-wr', allAbstained: false, ...overrides }
}

describe('weightedRandomSelector', () => {
  it('returns empty result for no candidates', () => {
    const result = weightedRandomSelector([], ctx())
    expect(result).toEqual({ models: [], trace: [] })
  })

  it('picks proportional to score: rng=0 picks the first candidate', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.2 },
      { model: 'b', score: 0.8 },
    ]
    const result = weightedRandomSelector(candidates, ctx({ rng: () => 0 }))
    expect(result.models[0]!.model).toBe('a')
  })

  it('rng pushed past first candidate weight share picks the second', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.2 },
      { model: 'b', score: 0.8 },
    ]
    // total=1.0, rng=0.5 -> r=0.5, subtract a(0.2) -> 0.3 remains -> subtract b(0.8) -> <=0 -> b
    const result = weightedRandomSelector(candidates, ctx({ rng: () => 0.5 }))
    expect(result.models[0]!.model).toBe('b')
  })

  it('falls back to uniform pick when all scores are 0', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0 },
      { model: 'b', score: 0 },
      { model: 'c', score: 0 },
    ]
    const result = weightedRandomSelector(candidates, ctx({ rng: () => 0.7 }))
    // uniform: floor(0.7*3) = 2 -> index 2 -> 'c'
    expect(result.models[0]!.model).toBe('c')
  })

  it('ranks the non-picked rest by score descending', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.1 },
      { model: 'b', score: 0.9 },
      { model: 'c', score: 0.5 },
    ]
    const result = weightedRandomSelector(candidates, ctx({ rng: () => 0 }))
    expect(result.models[0]!.model).toBe('a')
    expect(result.models.slice(1).map(m => m.model)).toEqual(['b', 'c'])
  })

  it('assigns descending weight by rank, first = highest weight', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
      { model: 'c', score: 0.5 },
    ]
    const result = weightedRandomSelector(candidates, ctx({ rng: () => 0 }))
    expect(result.models.map(m => m.weight)).toEqual([3, 2, 1])
  })

  it('defaults rng to Math.random when not provided', () => {
    const result = weightedRandomSelector([{ model: 'a', score: 0.5 }], ctx())
    expect(result.models).toHaveLength(1)
  })
})
