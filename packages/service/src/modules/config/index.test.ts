import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'

vi.mock('./migrate.js', () => ({
  migrateProjectConfigs: vi.fn(async () => 0),
  migrateSettings: vi.fn(async () => [] as string[]),
  migrateRouterStorage: vi.fn(async () => undefined as number | undefined),
  migrateRolePermissions: vi.fn(async () => 0),
  migrateUsageRouterId: vi.fn(async () => 0),
  migrateNotificationChannelScope: vi.fn(async () => 0),
  migrateOrchestratorCandidateOrder: vi.fn(async () => 0),
}))
vi.mock('./migrate-connections.js', () => ({
  migrateModelsToConnections: vi.fn(async () => ({ connections: 0, instances: 0 })),
}))

import { configModule } from './index.js'
import { readConfig, writeConfig, appendUsageRecord } from './loader.js'
import { migrateProjectConfigs, migrateSettings } from './migrate.js'
import { migrateModelsToConnections } from './migrate-connections.js'
import { PRODUCT_VERSION } from '../../core/version.js'

const mockMigrateProjects = vi.mocked(migrateProjectConfigs)
const mockMigrateConnections = vi.mocked(migrateModelsToConnections)
const mockMigrateSettings = vi.mocked(migrateSettings)

describe('config module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMigrateProjects.mockResolvedValue(0)
    mockMigrateConnections.mockResolvedValue({ connections: 0, instances: 0 })
    mockMigrateSettings.mockResolvedValue([])
  })

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
    expect(configModule.manifest.version).toBe(PRODUCT_VERSION)
  })

  it('runs every config migration', async () => {
    await configModule.migrate?.()

    expect(mockMigrateConnections).toHaveBeenCalledTimes(1)
    expect(mockMigrateProjects).toHaveBeenCalledTimes(1)
    expect(mockMigrateSettings).toHaveBeenCalledTimes(1)
  })

  it('logs the settings keys dropped from settings.json', async () => {
    mockMigrateSettings.mockResolvedValueOnce(['defaultTimeoutMs'])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await configModule.migrate?.()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('defaultTimeoutMs'))
    logSpy.mockRestore()
  })

  it('logs the migrated project count when any project changed shape', async () => {
    mockMigrateProjects.mockResolvedValueOnce(3)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await configModule.migrate?.()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('migrated 3'))
    logSpy.mockRestore()
  })

  it('still migrates projects when the connections migration fails', async () => {
    mockMigrateConnections.mockRejectedValueOnce(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await configModule.migrate?.()

    expect(mockMigrateProjects).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
