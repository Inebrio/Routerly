import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
}))

import { rateLimitPolicy } from './rate-limit.js'
import { readConfig } from '../../config/loader.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig, UsageRecord } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string, hasCallsLimit = false): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
    ...(hasCallsLimit ? { limits: [{ metric: 'calls', windowType: 'period', period: 'hourly', value: 100 }] } : {}),
  }
}

function makeRecord(modelId: string, secondsAgo: number): UsageRecord {
  return {
    id: `r-${modelId}-${secondsAgo}`,
    timestamp: new Date(Date.now() - secondsAgo * 1_000).toISOString(),
    projectId: 'p1', modelId,
    inputTokens: 100, outputTokens: 50, cost: 0.01,
    latencyMs: 300, outcome: 'success', callType: 'completion',
    costInput: 0.005, costOutput: 0.005, priceInput: 1, priceOutput: 3,
  } as UsageRecord
}

function makeInput(candidates: PolicyInput['candidates'], config?: any): PolicyInput {
  return { request: { model: 'auto', messages: [] }, candidates, config } as PolicyInput
}

describe('rateLimitPolicy', () => {
  it('returns 1.0 for models without calls limits (regardless of call count)', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('no-limit', 10),
      makeRecord('no-limit', 20),
    ])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('no-limit', false) },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.noLimit).toBe(true)
  })

  it('returns 1.0 for model with calls limit but no recent calls', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('m', true) },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('proportionally scores models with calls limits', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 10), makeRecord('a', 20), // 2 calls
      makeRecord('b', 10),                       // 1 call (minimum)
    ])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('a', true) },
      { model: makeModel('b', true) },
    ]))
    const aScore = result.routing.find(r => r.model === 'a')!.point
    const bScore = result.routing.find(r => r.model === 'b')!.point
    expect(bScore).toBe(1.0) // min count → 1.0
    expect(aScore).toBeCloseTo(0.5, 5) // minCount/count = 1/2
  })

  it('excludes models over hard maxCallsPerWindow threshold', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 10), makeRecord('a', 15), makeRecord('a', 20),
    ])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('a', true) },
    ], { maxCallsPerWindow: 3 }))
    expect(result.routing[0]!.point).toBe(0.0)
    expect(result.routing[0]!.rateLimited).toBe(true)
    expect(result.excludes).toContain('a')
  })

  it('does not apply maxCallsPerWindow to models without calls limits', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5), makeRecord('a', 10), makeRecord('a', 15), makeRecord('a', 20),
    ])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('a', false) },
    ], { maxCallsPerWindow: 1 }))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.excludes).toBeUndefined()
  })

  it('ignores records outside the time window', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 200), // 200 seconds ago, outside default 1-min window
    ])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('a', true) },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('respects custom windowMinutes', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 10),
    ])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('a', true) },
    ], { windowMinutes: 0.1 })) // 6 seconds window, record is 10s old
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('does not add excludes when no model is over threshold', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await rateLimitPolicy(makeInput([
      { model: makeModel('a', true) },
    ], { maxCallsPerWindow: 10 }))
    expect(result.excludes).toBeUndefined()
  })
})
