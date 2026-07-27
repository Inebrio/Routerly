import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { CONFIG_STORE, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { readConfig, writeConfig, appendUsageRecord } from '../config/loader.js'
import { coreModules } from './index.js'

// Registers all core modules against a fresh pipeline and asserts the per-phase
// processor order is exactly what Plan 4's lanes produced. This is the parity anchor:
// if a future edit reorders a processor within a phase, this test fails.
describe('core modules processor ordering', () => {
  it('produces the frozen per-phase processor sequence', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
    for (const mod of coreModules) await mod.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ids = (phase: string) => pipeline.orderedFor(phase).map((p) => p.id)

    expect(ids('ingress')).toEqual(['logging.ingress'])
    expect(ids('request.preprocess')).toEqual(['pii.input', 'guardrail.request'])
    expect(ids('routing.prepare')).toEqual(['routing.prepare', 'routing.memory'])
    expect(ids('upstream.prepare')).toEqual(['budget.upstream'])
    expect(ids('response.postprocess')).toEqual(['pii.output', 'guardrail.response'])
    expect(ids('finalize')).toEqual(['usage.finalize', 'logging.finalize'])
  })
})
