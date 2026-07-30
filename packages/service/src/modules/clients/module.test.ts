import { describe, it, expect, afterEach } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { clientConfiguratorModule, isClientConfiguratorEnabled, setClientConfiguratorEnabled } from './module.js'

describe('client-configurator module', () => {
  afterEach(() => {
    setClientConfiguratorEnabled(false)
  })

  it('has the frozen manifest', () => {
    expect(clientConfiguratorModule.manifest.id).toBe('client-configurator')
    expect(clientConfiguratorModule.manifest.version).toBe('0.4.0')
    expect(clientConfiguratorModule.manifest.dependsOn).toEqual({ config: '^0.4.0' })
  })

  it('register() runs without IO and marks the module enabled', async () => {
    expect(isClientConfiguratorEnabled()).toBe(false)
    const container = new ServiceContainer()
    const events = new EventBus()
    await clientConfiguratorModule.register({ container, events })
    expect(isClientConfiguratorEnabled()).toBe(true)
  })
})
