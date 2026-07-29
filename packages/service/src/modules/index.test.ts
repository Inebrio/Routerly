import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus } from '../core/index.js'
import { ALL_MODULES, coreModules, providerOAuthModule, providerWebModule } from './index.js'

describe('provider-oauth / provider-web module manifests', () => {
  it('are pure no-op predisposition slots: register cleanly, no side effects', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    expect(await providerOAuthModule.register({ container, events })).toBeUndefined()
    expect(await providerWebModule.register({ container, events })).toBeUndefined()
  })

  it('are direct ALL_MODULES entries, not bundled inside coreModules', () => {
    expect(coreModules.map((m) => m.manifest.id)).not.toContain('provider-oauth')
    expect(coreModules.map((m) => m.manifest.id)).not.toContain('provider-web')
    const allIds = ALL_MODULES.map((m) => m.manifest.id)
    expect(allIds).toContain('provider-oauth')
    expect(allIds).toContain('provider-web')
  })

  it('both depend on the always-on "provider" module', () => {
    expect(providerOAuthModule.manifest.dependsOn).toEqual({ provider: '^0.4.0' })
    expect(providerWebModule.manifest.dependsOn).toEqual({ provider: '^0.4.0' })
  })
})
