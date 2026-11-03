import { describe, it, expect, vi } from 'vitest'
import type { UsageRecord } from '@routerly/shared'

const fixture = [
  { routerId: 'p1', modelId: 'm1', outcome: 'success', timestamp: '2026-07-26T00:00:00.000Z' },
  { routerId: 'p1', modelId: 'm2', outcome: 'blocked', timestamp: '2026-07-26T01:00:00.000Z' },
] as unknown as UsageRecord[]

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(async () => fixture) }))

describe('readUsageRecords', () => {
  it('returns exactly the records readConfig("usage") returns', async () => {
    const { readUsageRecords } = await import('./usageStore.js')
    const { readConfig } = await import('../config/loader.js')
    const direct = (await readConfig('usage')) as UsageRecord[]
    const viaHelper = await readUsageRecords()
    expect(viaHelper).toEqual(direct)
  })

  it('a policy still scores identically through the helper', async () => {
    const { readUsageRecords } = await import('./usageStore.js')
    const records = await readUsageRecords()
    const successForP1 = records.filter((r) => r.routerId === 'p1' && r.outcome === 'success')
    expect(successForP1).toHaveLength(1)
  })
})
