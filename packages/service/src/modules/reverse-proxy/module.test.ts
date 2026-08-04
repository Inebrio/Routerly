import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import { PRODUCT_VERSION } from '../../core/version.js'
import { reverseProxyModule } from './module.js'
import { getProxyPipeline } from './run.js'
import { openaiTransportProcessors } from './lanes/openai.js'
import { anthropicTransportProcessors } from './lanes/anthropic.js'

describe('reverse-proxy module', () => {
  it('has the frozen manifest', () => {
    expect(reverseProxyModule.manifest.id).toBe('reverse-proxy')
    expect(reverseProxyModule.manifest.version).toBe(PRODUCT_VERSION)
    expect(reverseProxyModule.manifest.dependsOn).toEqual({ config: `^${PRODUCT_VERSION}`, provider: `^${PRODUCT_VERSION}` })
  })

  it('registers PROXY_PIPELINE with only the transport processors, and publishes it via setProxyPipeline', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    await reverseProxyModule.register({ container, events })

    expect(container.has(PROXY_PIPELINE)).toBe(true)
    const pipeline = container.resolve(PROXY_PIPELINE)
    // getProxyPipeline() (read by the lanes at request time) must resolve to the
    // exact same registry instance bound in the container.
    expect(getProxyPipeline() as unknown).toBe(pipeline)

    // Only the transport processors from both lanes are contributed, nothing else.
    const typed = pipeline as unknown as { orderedFor(phase: string): { id: string }[] }
    const expected = [...openaiTransportProcessors, ...anthropicTransportProcessors]
    for (const p of expected) {
      expect(typed.orderedFor(p.phase).some((q) => q.id === p.id)).toBe(true)
    }
    const touchedPhases = new Set(expected.map((p) => p.phase))
    const totalContributed = [...touchedPhases].reduce((n, phase) => n + typed.orderedFor(phase).length, 0)
    expect(totalContributed).toBe(expected.length)
  })
})
