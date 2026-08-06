import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
}))

import { fairnessPolicy } from './fairness.js'
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

function makeRecord(modelId: string, minutesAgo: number, outcome: 'success' | 'error' = 'success'): UsageRecord {
  return {
    id: `r-${modelId}-${minutesAgo}`,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    projectId: 'p1', modelId,
    inputTokens: 100, outputTokens: 50, cost: 0.01,
    latencyMs: 500, outcome, callType: 'completion',
    costInput: 0.005, costOutput: 0.005, priceInput: 1, priceOutput: 3,
  } as UsageRecord
}

function makeInput(candidates: PolicyInput['candidates'], config?: any): PolicyInput {
  return { request: { model: 'auto', messages: [] }, candidates, config } as PolicyInput
}

describe('fairnessPolicy', () => {
  it('returns 1.0 for all models when no usage records exist', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await fairnessPolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[1]!.point).toBe(1.0)
  })

  it('penalises model with more recent calls proportionally', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 10), makeRecord('a', 20), // 2 calls
      makeRecord('b', 15),                       // 1 call
    ])
    const result = await fairnessPolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ]))
    const aScore = result.routing.find(r => r.model === 'a')!.point
    const bScore = result.routing.find(r => r.model === 'b')!.point
    expect(aScore).toBeLessThan(bScore)
    // totalCalls=3, a=2/3 → 1-2/3=0.333; b=1/3 → 1-1/3=0.667
    expect(aScore).toBeCloseTo(1 - 2 / 3, 5)
    expect(bScore).toBeCloseTo(1 - 1 / 3, 5)
  })

  it('ignores error records (only success counts)', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 'error'),
      makeRecord('b', 5, 'success'),
    ])
    const result = await fairnessPolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ]))
    const aScore = result.routing.find(r => r.model === 'a')!.point
    const bScore = result.routing.find(r => r.model === 'b')!.point
    expect(aScore).toBe(1.0) // error ignored
    expect(bScore).toBe(0.0) // 100% of calls
  })

  it('ignores records outside the time window', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 120), // 2 hours ago, outside default 60min window
    ])
    const result = await fairnessPolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('respects custom windowMinutes config', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5), // 5 min ago
    ])
    const result = await fairnessPolicy(makeInput([{ model: makeModel('a') }], { windowMinutes: 3 }))
    // 5 min ago is outside 3-min window → 1.0
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('scores a model with 100% of calls at 0.0', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5), makeRecord('a', 10),
    ])
    const result = await fairnessPolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ]))
    expect(result.routing.find(r => r.model === 'a')!.point).toBe(0)
    expect(result.routing.find(r => r.model === 'b')!.point).toBe(1.0)
  })

  it('ignores records from other projects when projectId is provided', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 10),                                   // project p1
      { ...makeRecord('b', 10), projectId: 'p2' },           // different project
    ])
    const result = await fairnessPolicy({
      request: { model: 'auto', messages: [] },
      candidates: [{ model: makeModel('a') }, { model: makeModel('b') }],
      projectId: 'p1',
    } as PolicyInput)
    // Only 'a' has a call in p1 → a=100% share → score 0; b=0 calls → score 1.0
    expect(result.routing.find(r => r.model === 'a')!.point).toBe(0)
    expect(result.routing.find(r => r.model === 'b')!.point).toBe(1.0)
  })
})
