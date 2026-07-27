import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { piiModule } from './index.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('pii module', () => {
  it('contributes input + output PII processors', async () => {
    const { container, events } = harness()
    await piiModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('request.preprocess').map((p) => p.id)).toContain('pii.input')
    expect(pipeline.orderedFor('response.postprocess').map((p) => p.id)).toContain('pii.output')
  })

  it('orders pii.input before guardrail-style later processors via weight', async () => {
    const { container, events } = harness()
    await piiModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    // pii.input carries weight -10 so it wins the ready-set tiebreak and runs first.
    expect(pipeline.orderedFor('request.preprocess')[0]?.id).toBe('pii.input')
  })
})
