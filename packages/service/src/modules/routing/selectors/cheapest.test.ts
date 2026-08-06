import { describe, it, expect } from 'vitest'
import { cheapestSelector } from './index.js'
import type { ScoredCandidate, SelectorContext } from './types.js'

const ctx: SelectorContext = { projectId: 'proj-cheapest', allAbstained: false }

describe('cheapestSelector', () => {
  it('returns empty result for no candidates', () => {
    const result = cheapestSelector([], ctx)
    expect(result).toEqual({ models: [], trace: [] })
  })

  it('picks the lowest-cost candidate first', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'pricey', score: 0.5, cost: 10 },
      { model: 'cheap', score: 0.1, cost: 1 },
      { model: 'mid', score: 0.9, cost: 5 },
    ]
    const result = cheapestSelector(candidates, ctx)
    expect(result.models.map(m => m.model)).toEqual(['cheap', 'mid', 'pricey'])
  })

  it('breaks cost ties by higher score', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'lowscore', score: 0.2, cost: 3 },
      { model: 'highscore', score: 0.8, cost: 3 },
    ]
    const result = cheapestSelector(candidates, ctx)
    expect(result.models[0]!.model).toBe('highscore')
  })

  it('sorts undefined-cost candidates last, regardless of score', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'no-cost', score: 0.9 },
      { model: 'has-cost', score: 0.1, cost: 5 },
    ]
    const result = cheapestSelector(candidates, ctx)
    expect(result.models.map(m => m.model)).toEqual(['has-cost', 'no-cost'])
  })

  it('sorts undefined-cost candidates last with the reverse input order too', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'has-cost', score: 0.1, cost: 5 },
      { model: 'no-cost', score: 0.9 },
    ]
    const result = cheapestSelector(candidates, ctx)
    expect(result.models.map(m => m.model)).toEqual(['has-cost', 'no-cost'])
  })

  it('when all costs are undefined, ranks by score descending', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.2 },
      { model: 'b', score: 0.9 },
    ]
    const result = cheapestSelector(candidates, ctx)
    expect(result.models.map(m => m.model)).toEqual(['b', 'a'])
  })

  it('assigns descending weight by rank', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5, cost: 1 },
      { model: 'b', score: 0.5, cost: 2 },
    ]
    const result = cheapestSelector(candidates, ctx)
    expect(result.models.map(m => m.weight)).toEqual([2, 1])
  })
})
