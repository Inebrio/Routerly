import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { routeRequest } from './router.js'
import { routingModule } from './index.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  const pipeline = new ProcessorRegistry<ProxyContext>()
  container.register(PROXY_PIPELINE, pipeline)
  return { container, events, pipeline }
}

describe('routing module', () => {
  it('registers ROUTER with the real routeRequest', async () => {
    const { container, events, pipeline } = harness()
    await routingModule.register({ container, events })
    expect(container.resolve(ROUTER).routeRequest).toBe(routeRequest)
    void pipeline
  })

  it('contributes routing.prepare and routing.memory to the routing.prepare phase', async () => {
    const { container, events, pipeline } = harness()
    await routingModule.register({ container, events })
    const ids = pipeline.orderedFor('routing.prepare').map((p) => p.id)
    expect(ids).toEqual(['routing.prepare', 'routing.memory'])
  })
})
