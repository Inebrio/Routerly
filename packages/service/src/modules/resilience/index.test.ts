import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { RESILIENCE_STORE } from '../../core/tokens.js'
import { InMemoryResilienceStore } from './store.js'
import { resilienceModule } from './index.js'

describe('resilience module', () => {
  it('registers RESILIENCE_STORE with an InMemoryResilienceStore', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    await resilienceModule.register({ container, events })
    expect(container.resolve(RESILIENCE_STORE)).toBeInstanceOf(InMemoryResilienceStore)
  })

  it('has manifest.id === "resilience"', () => {
    expect(resilienceModule.manifest.id).toBe('resilience')
  })
})
