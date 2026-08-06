import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'

const { mockReadConfig, mockApplyRetention } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockApplyRetention: vi.fn(),
}))
vi.mock('../config/loader.js', () => ({
  readConfig: mockReadConfig,
  writeConfig: vi.fn(),
  appendUsageRecord: vi.fn(),
}))
vi.mock('../config/usageNdjson.js', () => ({
  applyUsageRetention: mockApplyRetention,
}))

import { trackUsage } from './tracker.js'
import { usageModule } from './index.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  container.register(CONFIG_STORE, { readConfig: mockReadConfig, writeConfig: vi.fn(), appendUsageRecord: vi.fn() })
  return { container, events }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReadConfig.mockResolvedValue({})
})

describe('usage module', () => {
  it('registers USAGE_TRACKER with the real trackUsage', async () => {
    const { container, events } = harness()
    await usageModule.register({ container, events })
    expect(container.resolve(USAGE_TRACKER).trackUsage).toBe(trackUsage)
  })

  it('contributes usage.finalize to the finalize phase', async () => {
    const { container, events } = harness()
    await usageModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('finalize').map((p) => p.id)).toEqual(['usage.finalize'])
  })

  // RTR-06: retention sweep lifecycle — mirrors observability/index.test.ts's
  // "runs the metric push for as long as the module does" pattern.
  describe('retention sweep lifecycle', () => {
    it('start() runs one immediate sweep using the configured policy, then schedules the interval', async () => {
      vi.useFakeTimers()
      mockReadConfig.mockResolvedValue({ usageRetention: { maxAgeDays: 30 } })
      try {
        await usageModule.start!({} as never)
        expect(mockApplyRetention).toHaveBeenCalledTimes(1)
        expect(mockApplyRetention).toHaveBeenCalledWith({ maxAgeDays: 30 })

        await vi.advanceTimersByTimeAsync(60_000)
        expect(mockApplyRetention).toHaveBeenCalledTimes(2)
      } finally {
        await usageModule.stop!()
        vi.useRealTimers()
      }
    })

    it('stop() clears the interval — no further sweeps run', async () => {
      vi.useFakeTimers()
      mockReadConfig.mockResolvedValue({ usageRetention: { maxAgeDays: 30 } })
      try {
        await usageModule.start!({} as never)
        expect(mockApplyRetention).toHaveBeenCalledTimes(1)

        await usageModule.stop!()
        await vi.advanceTimersByTimeAsync(180_000)
        expect(mockApplyRetention).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not call applyUsageRetention when no retention policy is configured', async () => {
      mockReadConfig.mockResolvedValue({})
      try {
        await usageModule.start!({} as never)
        expect(mockApplyRetention).not.toHaveBeenCalled()
      } finally {
        await usageModule.stop!()
      }
    })

    it('a sweep failure is swallowed — does not throw out of start()', async () => {
      mockReadConfig.mockRejectedValue(new Error('config read failed'))
      try {
        await expect(usageModule.start!({} as never)).resolves.toBeUndefined()
      } finally {
        await usageModule.stop!()
      }
    })
  })
})
