import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { guardrailsModule } from './guardrails.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('guardrails module', () => {
  it('contributes request + response guardrail processors', async () => {
    const { container, events } = harness()
    await guardrailsModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('request.preprocess').map((p) => p.id)).toContain('guardrail.request')
    expect(pipeline.orderedFor('response.postprocess').map((p) => p.id)).toContain('guardrail.response')
  })
})
