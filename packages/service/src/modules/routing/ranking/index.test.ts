import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_RANKING_ALGORITHM, RANKING_ALGORITHMS, type ModelConfig, type SelectorType } from '@routerly/shared'
import { RANKING_MAP, resolveRankingAlgorithm } from './index.js'
import type { RankingInput } from './index.js'

function candidate(id: string, cost = 1): RankingInput['scoringCandidates'][number] {
  const model: ModelConfig = {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: cost, outputPerMillion: cost },
  }
  return { model }
}

describe('resolveRankingAlgorithm', () => {
  it('absent id -> default, no warning', () => {
    const log = { warn: vi.fn() }
    expect(resolveRankingAlgorithm(undefined, log)).toBe(DEFAULT_RANKING_ALGORITHM)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('every registered id resolves to itself', () => {
    for (const id of RANKING_ALGORITHMS) expect(resolveRankingAlgorithm(id)).toBe(id)
  })

  it('unknown id -> default plus a warning', () => {
    const log = { warn: vi.fn() }
    expect(resolveRankingAlgorithm('jev', log)).toBe('default')
    expect(log.warn).toHaveBeenCalledWith({ rankingAlgorithm: 'jev' }, 'routing: unknown ranking algorithm, falling back to default')
  })

  it('unknown id without a logger still falls back', () => {
    expect(resolveRankingAlgorithm('jev')).toBe('default')
  })
})

describe('RANKING_MAP', () => {
  it('has an implementation for every registered algorithm', () => {
    for (const id of RANKING_ALGORITHMS) expect(typeof RANKING_MAP[id]).toBe('function')
  })

  it('default: weighted mean of the raw points, best first (argmax)', () => {
    const out = RANKING_MAP.default({
      scoringCandidates: [candidate('a'), candidate('b'), candidate('c')],
      successfulResults: [
        { type: 'cheapest', weight: 2, routing: [{ model: 'a', point: 1 }, { model: 'b', point: 0.5 }, { model: 'c', point: 0 }] },
        { type: 'context', weight: 1, routing: [{ model: 'a', point: 0.2 }, { model: 'b', point: 1 }, { model: 'c', point: 0.5 }] },
      ],
      selector: 'argmax',
      selectorCtx: { routerId: 'r' },
    })
    // a = (2*1+0.2)/3, b = (2*.5+1)/3, c = (0+.5)/3
    expect(out.scored.map(s => [s.model, s.score])).toEqual([['a', 0.7333], ['b', 0.6667], ['c', 0.1667]])
    expect(out.abstained).toEqual([])
    expect(out.allAbstained).toBe(false)
    expect(out.models).toEqual([{ model: 'a', weight: 3 }, { model: 'b', weight: 2 }, { model: 'c', weight: 1 }])
  })

  it('default: a policy with equal points abstains, and all-abstained picks uniformly via the injected rng', () => {
    const out = RANKING_MAP.default({
      scoringCandidates: [candidate('a'), candidate('b')],
      successfulResults: [{ type: 'fairness', weight: 1, routing: [{ model: 'a', point: 0.5 }, { model: 'b', point: 0.5 }] }],
      selector: 'argmax',
      selectorCtx: { routerId: 'r', rng: () => 0.9 },
    })
    expect(out.abstained).toEqual(['fairness'])
    expect(out.allAbstained).toBe(true)
    expect(out.scored.map(s => s.score)).toEqual([0.5, 0.5])
    expect(out.models.map(m => m.model)).toEqual(['b', 'a']) // floor(0.9 * 2) = 1 -> b first
  })

  it('default: hands the profile selector the scored list', () => {
    const out = RANKING_MAP.default({
      scoringCandidates: [candidate('a'), candidate('b')],
      successfulResults: [{ type: 'x', weight: 1, routing: [{ model: 'a', point: 0.25 }, { model: 'b', point: 0.75 }] }],
      selector: 'weighted-random',
      // total 1.0; rng 0.1 -> r=0.1 <= 0.25 -> a is picked although b scores higher
      selectorCtx: { routerId: 'r', rng: () => 0.1 },
    })
    expect(out.models.map(m => m.model)).toEqual(['a', 'b'])
  })

  it('default: a stale removed selector (profile not yet migrated) falls back to argmax without throwing', () => {
    for (const stale of ['cheapest', 'lowest-latency', 'round-robin']) {
      const out = RANKING_MAP.default({
        scoringCandidates: [candidate('a'), candidate('b')],
        successfulResults: [{ type: 'x', weight: 1, routing: [{ model: 'a', point: 0.1 }, { model: 'b', point: 0.9 }] }],
        selector: stale as SelectorType,
        selectorCtx: { routerId: 'r' },
      })
      expect(out.models.map(m => m.model)).toEqual(['b', 'a'])
    }
  })
})
