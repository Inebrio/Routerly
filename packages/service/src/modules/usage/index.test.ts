import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { readConfig, writeConfig, appendUsageRecord } from '../config/loader.js'
import { trackUsage } from './tracker.js'
import { usageModule } from './index.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  return { container, events }
}

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
})
