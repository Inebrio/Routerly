import { describe, it, expect } from 'vitest'
import {
  decayWeightedErrorScore,
  decayWeightedLatencyAverage,
  relativeLatencyScore,
  ratioScore,
  shareScore,
} from './scoring.js'
import type { UsageRecord } from '@routerly/shared'

function makeRecord(minutesAgo: number, latencyMs = 300, outcome: 'success' | 'error' | 'timeout' = 'success'): UsageRecord {
  return {
    id: `r-${minutesAgo}`,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    routerId: 'p1', modelId: 'm',
    inputTokens: 100, outputTokens: 50, cost: 0.01,
    latencyMs, outcome, callType: 'completion',
    costInput: 0.005, costOutput: 0.005, priceInput: 1, priceOutput: 3,
  } as UsageRecord
}

describe('decayWeightedErrorScore', () => {
  it('returns 1.0 / rate 0 / errorScore 1.0 for empty records', () => {
    const result = decayWeightedErrorScore([], Date.now(), 5 * 60_000, 2, 0.9)
    expect(result).toEqual({ point: 1.0, weightedErrorRate: 0, errorScore: 1.0 })
  })

  it('a single success record scores 1.0', () => {
    const now = Date.now()
    const result = decayWeightedErrorScore([makeRecord(1)], now, 5 * 60_000, 2, 0.9)
    expect(result.point).toBe(1.0)
    expect(result.weightedErrorRate).toBe(0)
  })

  it('a single error record trips below 1.0 and raises weightedErrorRate to 1', () => {
    const now = Date.now()
    const result = decayWeightedErrorScore([makeRecord(1, 300, 'error')], now, 5 * 60_000, 2, 0.9)
    expect(result.weightedErrorRate).toBe(1)
    expect(result.point).toBeLessThan(1.0)
  })

  it('circuit breaker zeroes the score when raw rate meets the threshold', () => {
    const now = Date.now()
    const records = Array.from({ length: 5 }, () => makeRecord(1, 300, 'error'))
    const result = decayWeightedErrorScore(records, now, 5 * 60_000, 2, 0.5)
    expect(result.point).toBe(0.0)
  })
})

describe('decayWeightedLatencyAverage', () => {
  it('returns null for empty records', () => {
    expect(decayWeightedLatencyAverage([], Date.now(), 5 * 60_000)).toBeNull()
  })

  it('returns the latency itself for a single record (no decay)', () => {
    const now = Date.now()
    expect(decayWeightedLatencyAverage([makeRecord(1, 250)], now, 0)).toBe(250)
  })

  it('averages tie latencies to the same value regardless of decay', () => {
    const now = Date.now()
    const records = [makeRecord(1, 200), makeRecord(2, 200)]
    expect(decayWeightedLatencyAverage(records, now, 5 * 60_000)).toBeCloseTo(200, 5)
    expect(decayWeightedLatencyAverage(records, now, 0)).toBe(200)
  })
})

describe('relativeLatencyScore', () => {
  it('gives everyone 1.0 when fewer than 2 candidates have data', () => {
    expect(relativeLatencyScore([null])).toEqual([1.0])
    expect(relativeLatencyScore([200, null])).toEqual([1.0, 1.0])
  })

  it('gives everyone 1.0 on a tie between two candidates with data', () => {
    expect(relativeLatencyScore([200, 200])).toEqual([1.0, 1.0])
  })

  it('scales the slower candidate by minLatency / avgLatency', () => {
    const [fast, slow] = relativeLatencyScore([200, 400])
    expect(fast).toBe(1.0)
    expect(slow).toBeCloseTo(0.5, 5)
  })
})

describe('ratioScore', () => {
  it('returns 1.0 when count is 0', () => {
    expect(ratioScore(0, 0)).toBe(1.0)
  })

  it('returns 1.0 when count equals minCount', () => {
    expect(ratioScore(1, 1)).toBe(1.0)
  })

  it('returns minCount / count when count exceeds minCount', () => {
    expect(ratioScore(2, 1)).toBeCloseTo(0.5, 5)
  })
})

describe('shareScore', () => {
  it('returns 1.0 when totalCount is 0', () => {
    expect(shareScore(0, 0)).toBe(1.0)
  })

  it('returns 0.0 when ownCount is the entire total', () => {
    expect(shareScore(3, 3)).toBe(0.0)
  })

  it('returns 1 - share otherwise', () => {
    expect(shareScore(1, 3)).toBeCloseTo(1 - 1 / 3, 5)
  })
})
