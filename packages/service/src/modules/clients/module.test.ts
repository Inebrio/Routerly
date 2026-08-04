import { describe, it, expect, afterEach } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { clientConfiguratorModule, isClientConfiguratorEnabled, setClientConfiguratorEnabled } from './module.js'
import { PRODUCT_VERSION } from '../../core/version.js'

describe('client-configurator module', () => {
  afterEach(() => {
    setClientConfiguratorEnabled(false)
  })

  it('has the frozen manifest', () => {
    expect(clientConfiguratorModule.manifest.id).toBe('client-configurator')
    expect(clientConfiguratorModule.manifest.version).toBe(PRODUCT_VERSION)
    expect(clientConfiguratorModule.manifest.dependsOn).toEqual({ config: `^${PRODUCT_VERSION}` })
  })

  it('register() runs without IO and marks the module enabled', async () => {
    expect(isClientConfiguratorEnabled()).toBe(false)
    const container = new ServiceContainer()
    const events = new EventBus()
    await clientConfiguratorModule.register({ container, events })
    expect(isClientConfiguratorEnabled()).toBe(true)
  })
})
