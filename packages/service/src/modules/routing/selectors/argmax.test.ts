import { describe, it, expect } from 'vitest'
import { argmaxSelector } from './index.js'
import type { ScoredCandidate, SelectorContext } from './types.js'

function ctx(overrides: Partial<SelectorContext> = {}): SelectorContext {
  return { projectId: 'proj-argmax', allAbstained: false, ...overrides }
}

describe('argmaxSelector', () => {
  it('returns empty result for no candidates', () => {
    const result = argmaxSelector([], ctx())
    expect(result).toEqual({ models: [], trace: [] })
  })

  it('picks the highest-score candidate first, ranked by score desc', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'low', score: 0.2 },
      { model: 'high', score: 0.9 },
      { model: 'mid', score: 0.5 },
    ]
    const result = argmaxSelector(candidates, ctx())
    expect(result.models.map(m => m.model)).toEqual(['high', 'mid', 'low'])
    expect(result.models[0]!.weight).toBeGreaterThan(result.models[1]!.weight)
    expect(result.trace).toEqual([])
  })

  it('breaks ties within 0.0001 by weighted-random among the tied top', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.8 },
      { model: 'b', score: 0.80005 },
      { model: 'low', score: 0.1 },
    ]
    // tiedTop (sorted desc) = [b, a]; rng=0 -> weighted pick lands on first iterated (b)
    const lowRng = argmaxSelector(candidates, ctx({ rng: () => 0 }))
    expect(lowRng.models[0]!.model).toBe('b')
    expect(lowRng.models[2]!.model).toBe('low')

    // rng pushed past b's weight share -> weighted pick lands on a
    const highRng = argmaxSelector(candidates, ctx({ rng: () => 0.9 }))
    expect(highRng.models[0]!.model).toBe('a')
    expect(highRng.models[2]!.model).toBe('low')
  })

  it('tie-break rng selects the second tied candidate when rng pushes past the first weight', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
    ]
    // total weight = 1.0, rng=0.99 -> r=0.99, subtract a's 0.5 -> 0.49 remains -> picks b
    const result = argmaxSelector(candidates, ctx({ rng: () => 0.99 }))
    expect(result.models[0]!.model).toBe('b')
  })

  it('single candidate with no tie returns it directly', () => {
    const result = argmaxSelector([{ model: 'solo', score: 0.5 }], ctx())
    expect(result.models).toEqual([{ model: 'solo', weight: 1 }])
  })

  it('when allAbstained, picks uniformly at random among all candidates regardless of score', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.1 },
      { model: 'b', score: 0.9 },
      { model: 'c', score: 0.5 },
    ]
    // rng=0.5 * 3 = 1.5 -> floor -> index 1 -> 'b'
    const result = argmaxSelector(candidates, ctx({ allAbstained: true, rng: () => 0.5 }))
    expect(result.models[0]!.model).toBe('b')
    expect(result.models).toHaveLength(3)
  })

  it('allAbstained with rng near 1 clamps to the last candidate index', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.1 },
      { model: 'b', score: 0.9 },
    ]
    const result = argmaxSelector(candidates, ctx({ allAbstained: true, rng: () => 0.999999 }))
    expect(result.models[0]!.model).toBe('b')
  })

  it('defaults rng to Math.random when not provided', () => {
    const result = argmaxSelector([{ model: 'a', score: 0.5 }, { model: 'b', score: 0.5 }], ctx())
    expect(result.models).toHaveLength(2)
  })

  it('preserves prompt field on the picked candidate', () => {
    const result = argmaxSelector([{ model: 'a', score: 0.9, prompt: 'be concise' }], ctx())
    expect(result.models[0]).toEqual({ model: 'a', weight: 1, prompt: 'be concise' })
  })
})
