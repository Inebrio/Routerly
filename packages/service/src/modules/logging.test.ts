import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { getTrace } from '../routing/traceStore.js'
import { loggingModule } from './logging.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('logging module', () => {
  it('contributes ingress + finalize trace processors', async () => {
    const { container, events } = harness()
    await loggingModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('ingress').map((p) => p.id)).toContain('logging.ingress')
    expect(pipeline.orderedFor('finalize').map((p) => p.id)).toContain('logging.finalize')
  })

  it('logging.ingress opens the trace buffer', async () => {
    const { container, events } = harness()
    await loggingModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'logging.ingress')!
    const ctx = { traceId: 'trace-test-1' } as unknown as ProxyContext
    await ingress.run(ctx)
    expect(getTrace('trace-test-1')).toEqual([])
  })
})
