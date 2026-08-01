import { describe, it, expect } from 'vitest'
import type { ModelConfig, UsageRecord } from '@routerly/shared'
import { computeSavings, computeSeries } from './savings.js'

function model(id: string, inputPerMillion: number, outputPerMillion: number, cachePerMillion?: number): ModelConfig {
  return {
    id, name: id, provider: 'openai',
    cost: { inputPerMillion, outputPerMillion, ...(cachePerMillion !== undefined ? { cachePerMillion } : {}) },
  } as ModelConfig
}

let seq = 0
function record(partial: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: `r${++seq}`,
    timestamp: '2026-08-01T10:00:00.000Z',
    projectId: 'p1',
    modelId: 'cheap',
    inputTokens: 1000,
    outputTokens: 1000,
    cost: 0,
    latencyMs: 1000,
    outcome: 'success',
    callType: 'completion',
    ...partial,
  }
}

// cheap: $1/$2 per 1M — expensive: $10/$20 per 1M
const MODELS = [model('cheap', 1, 2), model('expensive', 10, 20)]

describe('computeSavings', () => {
  it('reprices the compared calls against every baseline model', () => {
    // 1000 in + 1000 out on cheap = 0.001 + 0.002 = 0.003
    const s = computeSavings([record({ cost: 0.003 })], MODELS, ['cheap', 'expensive'])
    expect(s.comparedCalls).toBe(1)
    expect(s.comparedCost).toBe(0.003)
    expect(s.comparedInputTokens).toBe(1000)
    expect(s.comparedOutputTokens).toBe(1000)
    expect(s.baselines).toHaveLength(2)
    const cheap = s.baselines.find(b => b.modelId === 'cheap')!
    const expensive = s.baselines.find(b => b.modelId === 'expensive')!
    expect(cheap.cost).toBe(0.003)
    expect(cheap.costDelta).toBe(0)
    expect(expensive.cost).toBe(0.03)
    // routing picked the cheap model: 0.003 actual vs 0.03 on the expensive baseline
    expect(expensive.costDelta).toBe(0.027)
    expect(expensive.costDeltaPercent).toBe(90)
  })

  it('sorts baselines cheapest first', () => {
    const s = computeSavings([record({ cost: 0.003 })], MODELS, ['expensive', 'cheap'])
    expect(s.baselines.map(b => b.modelId)).toEqual(['cheap', 'expensive'])
  })

  it('reports a negative delta when routing cost more than the baseline', () => {
    // all traffic served by the expensive model, cheap as the baseline
    const s = computeSavings([record({ modelId: 'expensive', cost: 0.03 })], MODELS, ['cheap'])
    expect(s.baselines[0]!.cost).toBe(0.003)
    expect(s.baselines[0]!.costDelta).toBe(-0.027)
  })

  it('skips routing, guardrail, failed and zero-token records', () => {
    const s = computeSavings([
      record({ cost: 0.003 }),
      record({ callType: 'routing', cost: 1 }),
      record({ callType: 'guardrail', cost: 1 }),
      record({ outcome: 'error', cost: 1 }),
      record({ outcome: 'blocked', cost: 1 }),
      // pass-through records carry no tokens (T60): nothing to reprice
      record({ inputTokens: 0, outputTokens: 0, cost: 0 }),
    ], MODELS, ['cheap'])
    expect(s.comparedCalls).toBe(1)
    expect(s.comparedCost).toBe(0.003)
  })

  it('treats a record without callType as a client call', () => {
    const noCallType = record({ cost: 0.003 })
    delete noCallType.callType
    const s = computeSavings([noCallType], MODELS, ['cheap'])
    expect(s.comparedCalls).toBe(1)
  })

  it('estimates baseline latency from the model own throughput', () => {
    const s = computeSavings([
      // cheap: 1000ms for 1000 output tokens -> 1 ms/token
      record({ cost: 0.003 }),
      // expensive: 400ms for 1000 output tokens -> 0.4 ms/token
      record({ modelId: 'expensive', latencyMs: 400, cost: 0.03 }),
    ], MODELS, ['cheap', 'expensive'])
    expect(s.comparedOutputTokens).toBe(2000)
    expect(s.comparedLatencyMs).toBe(1400)
    const expensive = s.baselines.find(b => b.modelId === 'expensive')!
    expect(expensive.latencySamples).toBe(1)
    expect(expensive.latencyMs).toBe(800) // 0.4 ms/token x 2000 tokens
    expect(expensive.latencyDeltaMs).toBe(-600) // routing took 1400ms, this baseline would have taken 800ms
  })

  it('leaves the time estimate out when a baseline produced no output token', () => {
    const s = computeSavings([record({ cost: 0.003 })], MODELS, ['expensive'])
    const expensive = s.baselines[0]!
    expect(expensive.latencySamples).toBe(0)
    expect(expensive.latencyMs).toBeUndefined()
    expect(expensive.latencyDeltaMs).toBeUndefined()
    expect(expensive.cost).toBe(0.03) // money is still exact
  })

  it('uses the median throughput, not the mean', () => {
    const s = computeSavings([
      record({ modelId: 'expensive', latencyMs: 100, cost: 0 }),
      record({ modelId: 'expensive', latencyMs: 200, cost: 0 }),
      record({ modelId: 'expensive', latencyMs: 9000, cost: 0 }), // outlier
      record({ cost: 0.003 }),
    ], MODELS, ['expensive'])
    // medians of 0.1, 0.2, 9 ms/token -> 0.2, applied to 4000 output tokens
    expect(s.baselines[0]!.latencyMs).toBe(800)
    expect(s.baselines[0]!.latencySamples).toBe(3)
  })

  it('counts prompt-cache savings against the serving model full input price', () => {
    // cached: $1/M input, $0.10/M cache read -> 1M cached tokens save $0.90
    const models = [model('cached', 1, 2, 0.1)]
    const s = computeSavings(
      [record({ modelId: 'cached', inputTokens: 1_000_000, outputTokens: 10, cachedInputTokens: 1_000_000, cost: 0.1 })],
      models,
      ['cached'],
    )
    expect(s.cache.inputTokens).toBe(1_000_000)
    expect(s.cache.cost).toBe(0.9)
  })

  it('reports no cache saving when the model has no cache price', () => {
    const s = computeSavings(
      [record({ inputTokens: 1000, cachedInputTokens: 1000, cost: 0.003 })],
      MODELS,
      ['cheap'],
    )
    expect(s.cache.inputTokens).toBe(1000)
    expect(s.cache.cost).toBe(0)
  })

  it('drops a baseline whose model no longer exists', () => {
    const s = computeSavings([record({ cost: 0.003 })], MODELS, ['cheap', 'deleted-model'])
    expect(s.baselines.map(b => b.modelId)).toEqual(['cheap'])
  })

  it('returns an empty summary when nothing matches', () => {
    const s = computeSavings([], MODELS, ['cheap'])
    expect(s.comparedCalls).toBe(0)
    expect(s.comparedCost).toBe(0)
    expect(s.cache).toEqual({ inputTokens: 0, cost: 0 })
    expect(s.baselines).toEqual([
      { modelId: 'cheap', cost: 0, costDelta: 0, costDeltaPercent: 0, latencySamples: 0 },
    ])
    expect(s.optimizers).toEqual([])
  })
})

// ── Per-optimizer measured savings (T63) ──────────────────────────────────────

describe('computeSavings — optimizers', () => {
  it('sums tokens removed by each optimizer and prices them on the serving model', () => {
    const s = computeSavings(
      [
        record({ modelId: 'cheap', optimizers: [{ id: 'ccr', tokensBefore: 1000, tokensAfter: 400 }] }),
        record({ modelId: 'expensive', optimizers: [{ id: 'ccr', tokensBefore: 500, tokensAfter: 100 }] }),
      ],
      MODELS,
      ['cheap'],
    )
    const ccr = s.optimizers.find(o => o.id === 'ccr')!
    expect(ccr.calls).toBe(2)
    expect(ccr.tokensSaved).toBe(1000)
    // 600 tokens at $1/1M + 400 tokens at $10/1M
    expect(ccr.costSaved).toBe(0.0006 + 0.004)
    expect(ccr.rolledBack).toBe(0)
  })

  it('keeps one entry per optimizer, most tokens saved first', () => {
    const s = computeSavings(
      [
        record({
          optimizers: [
            { id: 'rtk', tokensBefore: 1000, tokensAfter: 950 },
            { id: 'ccr', tokensBefore: 950, tokensAfter: 300 },
          ],
        }),
      ],
      MODELS,
      ['cheap'],
    )
    expect(s.optimizers.map(o => o.id)).toEqual(['ccr', 'rtk'])
    expect(s.optimizers.map(o => o.tokensSaved)).toEqual([650, 50])
  })

  it('counts a rolled-back step without crediting it any saving', () => {
    const s = computeSavings(
      [record({ optimizers: [{ id: 'caveman', tokensBefore: 1000, tokensAfter: 1000, rolledBack: true }] })],
      MODELS,
      ['cheap'],
    )
    expect(s.optimizers).toEqual([{ id: 'caveman', calls: 0, tokensSaved: 0, costSaved: 0, rolledBack: 1 }])
  })

  it('ignores a step that grew the prompt instead of shrinking it', () => {
    const s = computeSavings(
      [record({ optimizers: [{ id: 'ccr', tokensBefore: 100, tokensAfter: 140 }] })],
      MODELS,
      ['cheap'],
    )
    expect(s.optimizers[0]!.tokensSaved).toBe(0)
    expect(s.optimizers[0]!.costSaved).toBe(0)
  })

  it('still counts tokens when the serving model no longer exists, at no cost', () => {
    const s = computeSavings(
      [record({ modelId: 'deleted', optimizers: [{ id: 'ccr', tokensBefore: 1000, tokensAfter: 400 }] })],
      MODELS,
      ['cheap'],
    )
    expect(s.optimizers).toEqual([{ id: 'ccr', calls: 1, tokensSaved: 600, costSaved: 0, rolledBack: 0 }])
  })

  it('leaves out records the counterfactual already excludes', () => {
    const s = computeSavings(
      [
        record({ callType: 'routing', optimizers: [{ id: 'ccr', tokensBefore: 1000, tokensAfter: 400 }] }),
        record({ outcome: 'error', optimizers: [{ id: 'ccr', tokensBefore: 1000, tokensAfter: 400 }] }),
      ],
      MODELS,
      ['cheap'],
    )
    expect(s.optimizers).toEqual([])
  })
})

describe('computeSeries', () => {
  const at = (timestamp: string, partial: Partial<UsageRecord> = {}) => record({ timestamp, cost: 0.003, ...partial })

  const seriesOf = (records: UsageRecord[], bucket: 'hour' | 'day', baselines = ['cheap', 'expensive']) =>
    computeSeries(records, MODELS, computeSavings(records, MODELS, baselines), bucket)

  it('buckets by hour', () => {
    const s = seriesOf([at('2026-08-01T10:15:00.000Z'), at('2026-08-01T10:47:00.000Z'), at('2026-08-01T11:02:00.000Z')], 'hour')
    expect(s.bucket).toBe('hour')
    expect(s.points.map(p => p.bucket)).toEqual(['2026-08-01T10', '2026-08-01T11'])
    expect(s.points[0]!.calls).toBe(2)
    expect(s.points[1]!.calls).toBe(1)
  })

  it('buckets by day', () => {
    const s = seriesOf([at('2026-07-31T23:00:00.000Z'), at('2026-08-01T01:00:00.000Z')], 'day')
    expect(s.points.map(p => p.bucket)).toEqual(['2026-07-31', '2026-08-01'])
  })

  it('sums cost and tokens inside a bucket', () => {
    const s = seriesOf([at('2026-08-01T10:00:00.000Z'), at('2026-08-01T10:30:00.000Z', { cachedInputTokens: 400 })], 'hour')
    expect(s.points[0]!.cost).toBe(0.006)
    expect(s.points[0]!.inputTokens).toBe(2000)
    expect(s.points[0]!.outputTokens).toBe(2000)
    expect(s.points[0]!.cachedInputTokens).toBe(400)
    expect(s.points[0]!.latencyMs).toBe(2000)
  })

  it('prices the counterfactual against the costliest baseline', () => {
    const s = seriesOf([at('2026-08-01T10:00:00.000Z')], 'hour')
    expect(s.baselineModelId).toBe('expensive')
    // 1000 in + 1000 out at $10/$20 per 1M
    expect(s.points[0]!.baselineCost).toBe(0.03)
  })

  it('estimates baseline latency from that baseline own throughput', () => {
    const records = [
      at('2026-08-01T10:00:00.000Z'),
      at('2026-08-01T11:00:00.000Z', { modelId: 'expensive', cost: 0.03, latencyMs: 4000 }),
    ]
    const s = seriesOf(records, 'hour')
    // expensive runs at 4 ms per output token, each bucket produced 1000 output tokens
    expect(s.points.map(p => p.baselineLatencyMs)).toEqual([4000, 4000])
  })

  it('leaves the counterfactual empty when there is no baseline', () => {
    const s = seriesOf([at('2026-08-01T10:00:00.000Z')], 'hour', [])
    expect(s.baselineModelId).toBeUndefined()
    expect(s.points[0]!.baselineCost).toBe(0)
    expect(s.points[0]!.baselineLatencyMs).toBe(0)
  })

  it('counts only the records the savings summary compares', () => {
    const s = seriesOf([
      at('2026-08-01T10:00:00.000Z'),
      at('2026-08-01T10:10:00.000Z', { outcome: 'error' }),
      at('2026-08-01T10:20:00.000Z', { callType: 'routing' }),
      at('2026-08-01T10:30:00.000Z', { inputTokens: 0, outputTokens: 0 }),
    ], 'hour')
    expect(s.points[0]!.calls).toBe(1)
  })

  it('leaves quiet buckets out instead of zero filling them', () => {
    const s = seriesOf([at('2026-08-01T10:00:00.000Z'), at('2026-08-01T14:00:00.000Z')], 'hour')
    expect(s.points).toHaveLength(2)
  })

  it('keeps the most recent 60 buckets, oldest first', () => {
    const records = Array.from({ length: 70 }, (_, i) =>
      at(`2026-08-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`.replace('2026-08-01', `2026-06-${String((i % 28) + 1).padStart(2, '0')}`)))
    const s = seriesOf(records, 'day')
    expect(s.points.length).toBeLessThanOrEqual(60)
    const buckets = s.points.map(p => p.bucket)
    expect([...buckets].sort()).toEqual(buckets)
  })

  it('returns no point at all when nothing is comparable', () => {
    const s = seriesOf([at('2026-08-01T10:00:00.000Z', { outcome: 'blocked' })], 'hour')
    expect(s.points).toEqual([])
  })
})
