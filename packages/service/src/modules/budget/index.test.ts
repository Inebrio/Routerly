import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from './budget.js'
import { budgetModule } from './index.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('budget module', () => {
  it('registers BUDGET with the real functions', async () => {
    const { container, events } = harness()
    await budgetModule.register({ container, events })
    const b = container.resolve(BUDGET)
    expect(b.isAllowed).toBe(isAllowed)
    expect(b.getViolatedLimits).toBe(getViolatedLimits)
    expect(b.getLimitUsageSnapshot).toBe(getLimitUsageSnapshot)
  })

  it('contributes budget.upstream to the upstream.prepare phase', async () => {
    const { container, events } = harness()
    await budgetModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('upstream.prepare').map((p) => p.id)).toEqual(['budget.upstream'])
  })
})
