import { describe, it, expect } from 'vitest'
import { lowestLatencySelector } from './index.js'
import type { ScoredCandidate, SelectorContext } from './types.js'

function ctx(overrides: Partial<SelectorContext> = {}): SelectorContext {
  return { projectId: 'proj-latency', allAbstained: false, ...overrides }
}

describe('lowestLatencySelector', () => {
  it('returns empty result for no candidates', () => {
    const result = lowestLatencySelector([], ctx())
    expect(result).toEqual({ models: [], trace: [] })
  })

  it('picks the lowest-latency candidate first', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'slow', score: 0.5 },
      { model: 'fast', score: 0.5 },
      { model: 'mid', score: 0.5 },
    ]
    const latency: Record<string, number> = { slow: 900, fast: 100, mid: 400 }
    const result = lowestLatencySelector(candidates, ctx({ latencyOf: m => latency[m] }))
    expect(result.models.map(m => m.model)).toEqual(['fast', 'mid', 'slow'])
  })

  it('sorts unknown-latency candidates last', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'unknown', score: 0.9 },
      { model: 'known', score: 0.1 },
    ]
    const result = lowestLatencySelector(candidates, ctx({ latencyOf: m => (m === 'known' ? 50 : undefined) }))
    expect(result.models.map(m => m.model)).toEqual(['known', 'unknown'])
  })

  it('sorts unknown-latency candidates last with the reverse input order too', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'known', score: 0.1 },
      { model: 'unknown', score: 0.9 },
    ]
    const result = lowestLatencySelector(candidates, ctx({ latencyOf: m => (m === 'known' ? 50 : undefined) }))
    expect(result.models.map(m => m.model)).toEqual(['known', 'unknown'])
  })

  it('without latencyOf, all candidates are treated as unknown and order is preserved', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
    ]
    const result = lowestLatencySelector(candidates, ctx())
    expect(result.models.map(m => m.model)).toEqual(['a', 'b'])
  })

  it('filters out candidates where isAvailable returns false', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'down', score: 0.5 },
      { model: 'up', score: 0.5 },
    ]
    const latency: Record<string, number> = { down: 10, up: 500 }
    const result = lowestLatencySelector(
      candidates,
      ctx({ latencyOf: m => latency[m], isAvailable: m => m !== 'down' }),
    )
    expect(result.models.map(m => m.model)).toEqual(['up'])
  })

  it('does not filter when isAvailable is not supplied', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
    ]
    const result = lowestLatencySelector(candidates, ctx())
    expect(result.models).toHaveLength(2)
  })

  it('assigns descending weight by rank', () => {
    const candidates: ScoredCandidate[] = [
      { model: 'a', score: 0.5 },
      { model: 'b', score: 0.5 },
    ]
    const result = lowestLatencySelector(candidates, ctx({ latencyOf: m => (m === 'a' ? 10 : 20) }))
    expect(result.models.map(m => m.weight)).toEqual([2, 1])
  })
})
