import { describe, it, expect } from 'vitest'
import type { ResilienceStore } from '@routerly/shared'
import { ServiceContainer, EventBus, createRouteRegistry } from '../../core/index.js'
import { RESILIENCE_STORE, API_ROUTES } from '../../core/tokens.js'
import { InMemoryResilienceStore } from './store.js'
import { resilienceModule, setResilienceStore, getResilienceStore } from './index.js'
import { PRODUCT_VERSION } from '../../core/version.js'

/**
 * resilienceModule.register() now depends on API_ROUTES (dependsOn: { api } enforces
 * apiModule.register() running first in the real kernel) — every test that calls register()
 * directly on a hand-built container must register it too, or resolve() throws.
 */
function buildContainer(): { container: ServiceContainer; events: EventBus } {
  const container = new ServiceContainer()
  container.register(API_ROUTES, createRouteRegistry())
  return { container, events: new EventBus() }
}

describe('resilience module', () => {
  it('registers RESILIENCE_STORE with an InMemoryResilienceStore', async () => {
    const { container, events } = buildContainer()
    await resilienceModule.register({ container, events })
    expect(container.resolve(RESILIENCE_STORE)).toBeInstanceOf(InMemoryResilienceStore)
  })

  it('has manifest.id === "resilience"', () => {
    expect(resilienceModule.manifest.id).toBe('resilience')
  })

  it('declares dependsOn: { api } so it always registers after apiModule (G3 module gating)', () => {
    expect(resilienceModule.manifest.dependsOn).toEqual({ api: `^${PRODUCT_VERSION}` })
  })

  it('register() also publishes the same store instance via getResilienceStore()', async () => {
    const { container, events } = buildContainer()
    await resilienceModule.register({ container, events })
    expect(getResilienceStore()).toBe(container.resolve(RESILIENCE_STORE))
  })

  it('contributes GET /api/resilience and POST /api/resilience/reset to the API_ROUTES registry', async () => {
    const { container, events } = buildContainer()
    await resilienceModule.register({ container, events })
    const routes = container.resolve(API_ROUTES).ordered()
    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', url: '/api/resilience' }),
      expect.objectContaining({ method: 'POST', url: '/api/resilience/reset' }),
    ]))
  })

  it('throws if API_ROUTES was never registered (real bug, not a supported degraded mode)', () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    expect(() => resilienceModule.register({ container, events })).toThrow()
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
