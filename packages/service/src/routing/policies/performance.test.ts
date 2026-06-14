import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
}))

import { performancePolicy } from './performance.js'
import { readConfig } from '../../config/loader.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig, UsageRecord } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

function makeRecord(modelId: string, minutesAgo: number, latencyMs: number, outcome: 'success' | 'error' | 'timeout' = 'success'): UsageRecord {
  return {
    id: `r-${modelId}-${minutesAgo}`,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    projectId: 'p1', modelId,
    inputTokens: 100, outputTokens: 50, cost: 0.01,
    latencyMs, outcome, callType: 'completion',
    costInput: 0.005, costOutput: 0.005, priceInput: 1, priceOutput: 3,
  } as UsageRecord
}

function makeInput(candidates: PolicyInput['candidates'], config?: any): PolicyInput {
  return { request: { model: 'auto', messages: [] }, candidates, config } as PolicyInput
}

describe('performancePolicy', () => {
  it('returns 1.0 for all models with no usage data', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await performancePolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[1]!.point).toBe(1.0)
  })

  it('assigns 1.0 to fastest model and proportional scores to slower ones', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('fast', 5, 200),
      makeRecord('slow', 5, 400),
    ])
    const result = await performancePolicy(makeInput([
      { model: makeModel('fast') },
      { model: makeModel('slow') },
    ], { halfLifeMinutes: 0 })) // no decay for deterministic test
    const fastScore = result.routing.find(r => r.model === 'fast')!.point
    const slowScore = result.routing.find(r => r.model === 'slow')!.point
    expect(fastScore).toBe(1.0)
    expect(slowScore).toBeCloseTo(0.5, 2)
  })

  it('returns 1.0 for all when only one model has data', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 200),
    ])
    const result = await performancePolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ], { halfLifeMinutes: 0 }))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[1]!.point).toBe(1.0)
  })

  it('excludes error and timeout records from latency calculation', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 50, 'error'),
      makeRecord('a', 6, 50, 'timeout'),
      makeRecord('b', 5, 300, 'success'),
    ])
    const result = await performancePolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ], { halfLifeMinutes: 0 }))
    // a has no valid records → 1.0 (exploration)
    expect(result.routing.find(r => r.model === 'a')!.point).toBe(1.0)
  })

  it('excludes records with latencyMs = 0', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 0),
    ])
    const result = await performancePolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.routing[0]!.sampleCount).toBe(0)
  })

  it('ignores records outside the time window', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 30, 100),
    ])
    const result = await performancePolicy(makeInput([{ model: makeModel('a') }], { windowMinutes: 10 }))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('respects minSamples threshold', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 200),
    ])
    const result = await performancePolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ], { halfLifeMinutes: 0, minSamples: 5 }))
    // a has only 1 sample < minSamples=5 → treated as no data → 1.0
    expect(result.routing.find(r => r.model === 'a')!.point).toBe(1.0)
  })

  it('includes sampleCount and avgLatencyMs in output', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 300),
    ])
    const result = await performancePolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.routing[0]!.sampleCount).toBe(1)
    expect(result.routing[0]!.avgLatencyMs).not.toBeNull()
  })

  it('returns null avgLatencyMs when candidate has no records (line 68 false branch)', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await performancePolicy(makeInput([{ model: makeModel('no-data') }]))
    expect(result.routing[0]!.avgLatencyMs).toBeNull()
  })
})
