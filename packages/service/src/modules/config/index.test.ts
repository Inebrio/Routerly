import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { configModule } from './index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from '../../config/loader.js'

describe('config module', () => {
  it('registers CONFIG_STORE with the real loader functions', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    await configModule.register({ container, events })

    expect(container.has(CONFIG_STORE)).toBe(true)
    const store = container.resolve(CONFIG_STORE)
    // Wrapper strategy: the token hands back the real functions, not copies.
    expect(store.readConfig).toBe(readConfig)
    expect(store.writeConfig).toBe(writeConfig)
    expect(store.appendUsageRecord).toBe(appendUsageRecord)
  })

  it('has the frozen manifest identity', () => {
    expect(configModule.manifest.id).toBe('config')
    expect(configModule.manifest.version).toBe('0.4.0')
  })
})
