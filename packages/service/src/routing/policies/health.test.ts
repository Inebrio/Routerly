import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
}))

import { healthPolicy } from './health.js'
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

function makeRecord(modelId: string, minutesAgo: number, outcome: 'success' | 'error' | 'timeout'): UsageRecord {
  return {
    id: `r-${modelId}-${minutesAgo}-${outcome}`,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    projectId: 'p1', modelId,
    inputTokens: 100, outputTokens: 50, cost: 0.01,
    latencyMs: 300, outcome, callType: 'completion',
    costInput: 0.005, costOutput: 0.005, priceInput: 1, priceOutput: 3,
  } as UsageRecord
}

function makeInput(candidates: PolicyInput['candidates'], config?: any): PolicyInput {
  return { request: { model: 'auto', messages: [] }, candidates, config } as PolicyInput
}

describe('healthPolicy', () => {
  it('returns 1.0 for all models with no recent records', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await healthPolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[1]!.point).toBe(1.0)
    expect(result.excludes).toBeUndefined()
  })

  it('returns 1.0 for model with only successful records', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 'success'),
      makeRecord('a', 10, 'success'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('reduces score for models with recent errors', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 2, 'error'),
      makeRecord('a', 3, 'success'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.routing[0]!.point).toBeLessThan(1.0)
    expect(result.routing[0]!.point).toBeGreaterThan(0)
  })

  it('trips circuit breaker when error rate >= threshold', async () => {
    // Many recent errors → circuit breaker fires
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 1, 'error'),
      makeRecord('a', 2, 'error'),
      makeRecord('a', 3, 'error'),
      makeRecord('a', 4, 'error'),
      makeRecord('a', 5, 'error'),
      makeRecord('a', 6, 'error'),
      makeRecord('a', 7, 'error'),
      makeRecord('a', 8, 'error'),
      makeRecord('a', 9, 'error'),
      makeRecord('a', 10, 'success'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }], { circuitBreaker: 0.5 }))
    expect(result.routing[0]!.point).toBe(0.0)
    expect(result.excludes).toContain('a')
  })

  it('counts timeout as error for health', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 1, 'timeout'),
      makeRecord('a', 2, 'timeout'),
      makeRecord('a', 3, 'timeout'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }], { circuitBreaker: 0.5 }))
    expect(result.routing[0]!.point).toBe(0.0)
  })

  it('ignores records outside the time window', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 30, 'error'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }], { windowMinutes: 10 }))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.recentCalls).toBe(0)
  })

  it('includes recentCalls and weightedErrorRate in output', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 'success'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.routing[0]!.recentCalls).toBe(1)
    expect(result.routing[0]!.weightedErrorRate).toBe(0)
  })

  it('does not add excludes when no circuit breaker trips', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('a', 5, 'success'),
    ])
    const result = await healthPolicy(makeInput([{ model: makeModel('a') }]))
    expect(result.excludes).toBeUndefined()
  })
})
