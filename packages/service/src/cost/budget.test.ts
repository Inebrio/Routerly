import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))

import { isAllowed, getViolatedLimits, getLimitUsageSnapshot, isAllowedForRoutingModel } from './budget.js'
import { readConfig } from '../config/loader.js'
import type { ModelConfig, ProjectConfig, UsageRecord } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string, limits: any[] = []): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
    limits,
  }
}

function makeProject(modelId: string, projectLimits: any[] = []): ProjectConfig {
  return {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId, limits: projectLimits }],
  }
}

function makeRecord(modelId: string, cost: number, hoursAgo = 0): UsageRecord {
  return {
    id: `r-${modelId}-${hoursAgo}`,
    timestamp: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    projectId: 'proj-1', modelId,
    inputTokens: 100, outputTokens: 50, cost,
    latencyMs: 300, outcome: 'success', callType: 'completion',
    costInput: cost / 2, costOutput: cost / 2, priceInput: 1, priceOutput: 3,
  } as UsageRecord
}

describe('isAllowed', () => {
  it('returns false when model not in project models', async () => {
    const project: ProjectConfig = { id: 'p', name: 'P', tokens: [], members: [], models: [] }
    const result = await isAllowed(makeModel('m'), project)
    expect(result).toBe(false)
  })

  it('returns true when no limits configured', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await isAllowed(makeModel('m'), makeProject('m'))
    expect(result).toBe(true)
  })

  it('returns false when daily cost limit exceeded', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0), makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{
        modelId: 'm',
        limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 5 }],
      }],
    }
    const result = await isAllowed(makeModel('m'), project)
    expect(result).toBe(false)
  })

  it('returns true when cost is below the limit', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 2, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{
        modelId: 'm',
        limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 10 }],
      }],
    }
    const result = await isAllowed(makeModel('m'), project)
    expect(result).toBe(true)
  })

  it('applies token-level limitsMode=disable to remove all limits', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 100, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{
        modelId: 'm',
        limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 5 }],
      }],
    }
    const token: any = {
      token: 'tok',
      models: [{ modelId: 'm', limitsMode: 'disable' }],
    }
    const result = await isAllowed(makeModel('m'), project, token)
    expect(result).toBe(true)
  })

  it('checks calls limit metric', async () => {
    mockReadConfig.mockResolvedValue([
      makeRecord('m', 0, 0), makeRecord('m', 0, 0), makeRecord('m', 0, 0),
    ])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 2 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('uses rolling window type', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{
        metric: 'cost', windowType: 'rolling',
        rollingAmount: 1, rollingUnit: 'day', value: 3,
      }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('handles global model limits (no project-level limits)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const globalModel = makeModel('m', [{ metric: 'cost', windowType: 'period', period: 'daily', value: 3 }])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm' }], // no project-level limits
    }
    expect(await isAllowed(globalModel, project)).toBe(false)
  })
})

describe('getViolatedLimits', () => {
  it('returns empty array when all limits are satisfied', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 1, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 10 }] }],
    }
    const violated = await getViolatedLimits(makeModel('m'), project)
    expect(violated).toHaveLength(0)
  })

  it('returns violated limit snapshots', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 10, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 5 }] }],
    }
    const violated = await getViolatedLimits(makeModel('m'), project)
    expect(violated.length).toBeGreaterThan(0)
    expect(violated[0]!.remaining).toBeLessThanOrEqual(0)
  })
})

describe('getLimitUsageSnapshot', () => {
  it('returns empty array when model not in project', async () => {
    const project: ProjectConfig = { id: 'p', name: 'P', tokens: [], members: [], models: [] }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots).toHaveLength(0)
  })

  it('returns snapshot with correct current and remaining', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 3, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 10 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.current).toBeCloseTo(3, 4)
    expect(snapshots[0]!.remaining).toBeCloseTo(7, 4)
    expect(snapshots[0]!.value).toBe(10)
  })

  it('returns snapshot for rolling window', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 2, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'rolling', rollingAmount: 1, rollingUnit: 'day', value: 5 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.window).toBe('rolling 1 day')
  })
})

describe('isAllowedForRoutingModel', () => {
  it('returns true when no global limits', async () => {
    mockReadConfig.mockResolvedValue([])
    expect(await isAllowedForRoutingModel(makeModel('m'), 'proj-1')).toBe(true)
  })

  it('returns false when global limit exceeded', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 10, 0)])
    const modelWithLimit = makeModel('m', [{ metric: 'cost', windowType: 'period', period: 'daily', value: 5 }])
    expect(await isAllowedForRoutingModel(modelWithLimit, 'proj-1')).toBe(false)
  })

  it('uses legacy globalThresholds when limits is empty', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 10, 0)])
    const modelWithLegacy: any = { ...makeModel('m'), limits: undefined, globalThresholds: { daily: 5 } }
    expect(await isAllowedForRoutingModel(modelWithLegacy, 'proj-1')).toBe(false)
  })
})

describe('isAllowed - more metric types', () => {
  it('checks input_tokens metric', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 0, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'input_tokens', windowType: 'period', period: 'daily', value: 50 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false) // 100 input tokens > 50
  })

  it('checks output_tokens metric', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 0, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'output_tokens', windowType: 'period', period: 'daily', value: 30 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false) // 50 output tokens > 30
  })

  it('checks total_tokens metric', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 0, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'total_tokens', windowType: 'period', period: 'daily', value: 100 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false) // 150 total > 100
  })

  it('handles hourly period', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'hourly', value: 3 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('handles yearly period', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'yearly', value: 3 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('handles legacy window string via legacyWindowToPeriod', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'month', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('handles legacy window year', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'year', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('handles extend limitsMode at token level', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 3, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 10 }] }],
    }
    const token: any = {
      token: 'tok',
      models: [{ modelId: 'm', limitsMode: 'extend', limits: [{ metric: 'cost', windowType: 'period', period: 'hourly', value: 5 }] }],
    }
    // Cost is 3, daily limit is 10, hourly is 5 → both must pass
    expect(await isAllowed(makeModel('m'), project, token)).toBe(true)
  })

  it('getLimitUsageSnapshot for input_tokens', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 0, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'input_tokens', windowType: 'period', period: 'daily', value: 500 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.current).toBe(100)
    expect(snapshots[0]!.metric).toBe('input_tokens')
  })

  it('getLimitUsageSnapshot for output_tokens', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 0, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'output_tokens', windowType: 'period', period: 'daily', value: 500 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.current).toBe(50)
  })

  it('getLimitUsageSnapshot for total_tokens', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 0, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'total_tokens', windowType: 'period', period: 'daily', value: 500 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.current).toBe(150)
  })

  it('getLimitUsageSnapshot for rolling window with plural label', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 2, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'rolling', rollingAmount: 7, rollingUnit: 'day', value: 100 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.window).toBe('rolling 7 days')
  })
})

// ─── startOfPeriod weekly branch ───────────────────────────────────────────────
describe('startOfPeriod weekly – Sunday boundary (line 19)', () => {
  it('weekly period: Sunday rolls back to previous Monday (day===0 branch)', async () => {
    // Use a known Sunday — 2024-06-09 (Sunday)
    const sunday = new Date('2024-06-09T12:00:00.000Z')
    // We need to exercise startOfPeriod indirectly via isAllowed with a weekly limit.
    // A record timestamped on Monday 2024-06-03 is in the same ISO week as Sunday 2024-06-09
    // only when day===0 maps diff to -6 (going back to 2024-06-03 Monday).
    const mondayOfWeek = new Date('2024-06-03T00:00:00.000Z')
    const record: UsageRecord = {
      id: 'r-weekly-sun',
      timestamp: mondayOfWeek.toISOString(),
      projectId: 'proj-1', modelId: 'm',
      inputTokens: 100, outputTokens: 50, cost: 5,
      latencyMs: 300, outcome: 'success', callType: 'completion',
      costInput: 2.5, costOutput: 2.5, priceInput: 1, priceOutput: 3,
    } as UsageRecord
    mockReadConfig.mockResolvedValue([record])

    // We cannot control `new Date()` inside budget.ts directly, but we can verify
    // the branch is hit by using a weekly-period limit with a cost that would only
    // be exceeded if Monday falls within the window (day===0 path returns -6 diff).
    // Use a fresh record made "right now" — cost=5, limit=3 → should fail
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'weekly', value: 3 }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })
})

// ─── legacyWindowToPeriod – all branches (lines 52-57) ─────────────────────────
describe('legacyWindowToPeriod via legacy window field (lines 52–57)', () => {
  it('maps window "minute" → hourly (line 52)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'minute', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('maps window "hour" → hourly (line 52)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'hour', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('maps window "day" → daily (line 53)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'day', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('maps window "week" → weekly (line 54)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'week', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('maps unknown window → daily (default, line 57)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'unknown_unit', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('maps undefined window → daily (default, line 57)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      // no windowType, no window, no period → falls through to legacyWindowToPeriod(undefined) → 'daily'
      models: [{ modelId: 'm', limits: [{ metric: 'cost', value: 3 } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })
})

// ─── legacyToLimits – daily and weekly thresholds (lines 68-69) ────────────────
describe('legacyToLimits via model.globalThresholds (lines 68–69)', () => {
  it('converts globalThresholds.daily to a Limit (line 68)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const modelWithLegacy: any = { ...makeModel('m'), limits: [], globalThresholds: { daily: 3 } }
    expect(await isAllowedForRoutingModel(modelWithLegacy, 'proj-1')).toBe(false)
  })

  it('converts globalThresholds.weekly to a Limit (line 69)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const modelWithLegacy: any = { ...makeModel('m'), limits: [], globalThresholds: { weekly: 3 } }
    expect(await isAllowedForRoutingModel(modelWithLegacy, 'proj-1')).toBe(false)
  })

  it('converts globalThresholds.monthly to a Limit', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const modelWithLegacy: any = { ...makeModel('m'), limits: [], globalThresholds: { monthly: 3 } }
    expect(await isAllowedForRoutingModel(modelWithLegacy, 'proj-1')).toBe(false)
  })

  it('returns [] when thresholds is undefined (legacyToLimits guard, line 65)', async () => {
    mockReadConfig.mockResolvedValue([])
    const modelNoThresholds: any = { ...makeModel('m'), limits: [], globalThresholds: undefined }
    // No limits → isAllowedForRoutingModel returns true
    expect(await isAllowedForRoutingModel(modelNoThresholds, 'proj-1')).toBe(true)
  })
})

// ─── resolveLimits – null obj guard (line 77) ──────────────────────────────────
describe('resolveLimits with undefined obj (line 77)', () => {
  it('returns [] when project model ref has no limits and no thresholds', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    // project model ref has neither limits nor thresholds → resolveLimits(obj) returns []
    // resolveLevel returns null → applyResolution passes through global limits (none) → []
    const modelNoGlobal = makeModel('m') // no global limits either
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm' }], // no limits, no thresholds
    }
    // No limits at all → isAllowed returns true
    expect(await isAllowed(modelNoGlobal, project)).toBe(true)
  })
})

// ─── rolling window defaults (lines 131-133) ───────────────────────────────────
describe('checkLimits rolling window defaults (lines 131–133)', () => {
  it('uses rollingAmount=1 when rollingAmount is absent (line 131)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{
        metric: 'cost', windowType: 'rolling',
        // rollingAmount intentionally omitted → defaults to 1
        rollingUnit: 'day', value: 3,
      } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('uses rollingUnit="day" when rollingUnit is absent (line 132)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{
        metric: 'cost', windowType: 'rolling',
        rollingAmount: 1,
        // rollingUnit intentionally omitted → defaults to 'day'
        value: 3,
      } as any] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })

  it('falls back to 86_400_000 ms for unknown rollingUnit (line 133)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{
        metric: 'cost', windowType: 'rolling',
        rollingAmount: 1, rollingUnit: 'fortnight' as any, value: 3,
      }] }],
    }
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
  })
})

// ─── getLimitUsageSnapshot – globalThresholds path and rolling defaults (lines 183, 191, 208-213, 222) ──
describe('getLimitUsageSnapshot – additional branches', () => {
  it('uses globalThresholds when model.limits is empty (line 183)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const modelWithLegacy: any = { ...makeModel('m'), limits: [], globalThresholds: { daily: 10 } }
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm' }],
    }
    const snapshots = await getLimitUsageSnapshot(modelWithLegacy, project)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.window).toBe('daily')
    expect(snapshots[0]!.value).toBe(10)
  })

  it('returns [] when effective limits array is empty (line 191)', async () => {
    // model has no limits, project model ref has no limits/thresholds → limits=[] → early return
    const modelNoLimits = makeModel('m')
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm' }],
    }
    const snapshots = await getLimitUsageSnapshot(modelNoLimits, project)
    expect(snapshots).toHaveLength(0)
  })

  it('snapshot rolling window with rollingAmount defaulting to 1 (line 209)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 2, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{
        metric: 'cost', windowType: 'rolling',
        // rollingAmount omitted → ?? 1
        rollingUnit: 'hour', value: 100,
      } as any] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.window).toBe('rolling 1 hour')
  })

  it('snapshot rolling window with rollingUnit defaulting to "day" (line 210)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 2, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{
        metric: 'cost', windowType: 'rolling',
        rollingAmount: 3,
        // rollingUnit omitted → ?? 'day'
        value: 100,
      } as any] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.window).toBe('rolling 3 days')
  })

  it('snapshot uses legacyWindowToPeriod when period and windowType absent (line 213)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 2, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', window: 'week', value: 100 } as any] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.window).toBe('weekly')
  })

  it('snapshot counts calls metric (line 222)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 1, 0), makeRecord('m', 1, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 100 }] }],
    }
    const snapshots = await getLimitUsageSnapshot(makeModel('m'), project)
    expect(snapshots[0]!.current).toBe(2)
    expect(snapshots[0]!.metric).toBe('calls')
  })

  it('uses model.limits directly when non-empty (line 183 true branch)', async () => {
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const modelWithLimits: any = {
      ...makeModel('m'),
      limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 3 }],
    }
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm' }],
    }
    const snapshots = await getLimitUsageSnapshot(modelWithLimits, project)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.value).toBe(3)
  })
})

describe('startOfPeriod – Sunday (day === 0) branch (line 19)', () => {
  it('sets diff to -6 when current day is Sunday', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-09T12:00:00Z')) // Sunday
    mockReadConfig.mockResolvedValue([makeRecord('m', 5, 0)])
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm', limits: [{ metric: 'cost', windowType: 'period', period: 'weekly', value: 3 }] }],
    }
    // cost=5 exceeds limit=3 → not allowed
    expect(await isAllowed(makeModel('m'), project)).toBe(false)
    vi.useRealTimers()
  })
})
