import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from './reverse-proxy/context.js'
import { cacheModule } from './cache.js'

describe('cache module', () => {
  it('is a no-op predisposition: registers cleanly and contributes no processor', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    const pipeline = new ProcessorRegistry<ProxyContext>()
    container.register(PROXY_PIPELINE, pipeline)
    await cacheModule.register({ container, events })
    expect(cacheModule.manifest.id).toBe('cache')
    expect(pipeline.orderedFor('request.preprocess')).toEqual([])
  })
})
