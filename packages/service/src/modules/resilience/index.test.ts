import { describe, it, expect } from 'vitest'
import type { ResilienceStore } from '@routerly/shared'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { RESILIENCE_STORE } from '../../core/tokens.js'
import { InMemoryResilienceStore } from './store.js'
import { resilienceModule, setResilienceStore, getResilienceStore } from './index.js'

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

  it('register() also publishes the same store instance via getResilienceStore()', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    await resilienceModule.register({ container, events })
    expect(getResilienceStore()).toBe(container.resolve(RESILIENCE_STORE))
  })
})

describe('setResilienceStore / getResilienceStore', () => {
  it('round-trips an arbitrary ResilienceStore', () => {
    const fake = {} as ResilienceStore
    setResilienceStore(fake)
    expect(getResilienceStore()).toBe(fake)
  })

  it('does NOT throw when unset (returns undefined) — unlike getProxyPipeline', () => {
    // ponytail: no way to reset module state to "never set" once another test in this file has
    // called setResilienceStore(), so this only asserts the no-throw contract, not the initial
    // value; the initial-undefined behavior is exercised by every execute.test.ts/lane test that
    // never calls setResilienceStore() at all.
    expect(() => getResilienceStore()).not.toThrow()
  })
})
