import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../../cost/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))

import { budgetRemainingPolicy } from './budget-remaining.js'
import { readConfig } from '../../config/loader.js'
import { getLimitUsageSnapshot } from '../../cost/budget.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockGetLimitUsageSnapshot = vi.mocked(getLimitUsageSnapshot)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

function makeInput(candidates: PolicyInput['candidates'], projectId?: string): PolicyInput {
  return { request: { model: 'auto', messages: [] }, candidates, projectId } as PolicyInput
}

describe('budgetRemainingPolicy', () => {
  it('returns 1.0 for all models when project not found', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'other-project' }])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
    ], 'missing-project'))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.minHeadroom).toBe(1.0)
    expect(mockGetLimitUsageSnapshot).not.toHaveBeenCalled()
  })

  it('returns 1.0 when getLimitUsageSnapshot returns empty array', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'p1' }])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
    ], 'p1'))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.snapshotCount).toBe(0)
  })

  it('computes headroom from snapshots', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'p1' }])
    // 50% budget used → headroom = 0.5
    mockGetLimitUsageSnapshot.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 5, remaining: 5 }])
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
    ], 'p1'))
    expect(result.routing[0]!.point).toBeCloseTo(0.5, 4)
    expect(result.routing[0]!.minHeadroom).toBeCloseTo(0.5, 4)
  })

  it('picks the minimum headroom across multiple snapshots', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'p1' }])
    mockGetLimitUsageSnapshot.mockResolvedValue([
      { metric: 'cost', window: 'daily', value: 100, current: 10, remaining: 90 },  // 0.9
      { metric: 'calls', window: 'hourly', value: 10, current: 8, remaining: 2 },   // 0.2
    ])
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
    ], 'p1'))
    expect(result.routing[0]!.point).toBeCloseTo(0.2, 4)
  })

  it('clamps headroom to 0 when limit exceeded', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'p1' }])
    mockGetLimitUsageSnapshot.mockResolvedValue([
      { metric: 'cost', window: 'daily', value: 10, current: 15, remaining: -5 },
    ])
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
    ], 'p1'))
    expect(result.routing[0]!.point).toBe(0)
  })

  it('handles limit with value = 0 gracefully (avoids division by zero)', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'p1' }])
    mockGetLimitUsageSnapshot.mockResolvedValue([
      { metric: 'cost', window: 'daily', value: 0, current: 0, remaining: 0 },
    ])
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
    ], 'p1'))
    expect(result.routing[0]!.point).toBe(0)
  })

  it('handles multiple models independently', async () => {
    mockReadConfig.mockResolvedValue([{ id: 'p1' }])
    mockGetLimitUsageSnapshot
      .mockResolvedValueOnce([{ metric: 'cost', window: 'daily', value: 10, current: 2, remaining: 8 }]) // 0.8
      .mockResolvedValueOnce([{ metric: 'cost', window: 'daily', value: 10, current: 9, remaining: 1 }]) // 0.1
    const result = await budgetRemainingPolicy(makeInput([
      { model: makeModel('a') },
      { model: makeModel('b') },
    ], 'p1'))
    const aScore = result.routing.find(r => r.model === 'a')!.point
    const bScore = result.routing.find(r => r.model === 'b')!.point
    expect(aScore).toBeGreaterThan(bScore)
  })
})
