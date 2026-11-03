import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RouterConfig } from '@routerly/shared'

const store: Record<string, unknown[]> = { routers: [], profiles: [] }

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(async (key: string) => store[key] ?? []),
  writeConfig: vi.fn(async (key: string, value: unknown[]) => {
    store[key] = value
  }),
}))

const router = (overrides: Partial<RouterConfig> = {}): RouterConfig =>
  ({ id: 'p1', name: 'Test', tokens: [], members: [], models: [], ...overrides }) as RouterConfig

beforeEach(() => {
  store.routers = []
  store.profiles = []
  vi.clearAllMocks()
})

describe('migrateProfiles', () => {
  it('renames profileId to routingProfileId', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    store.routers = [router({ profileId: 'fast' })]

    expect(await migrateProfiles()).toBe(1)
    expect(store.routers[0]).toMatchObject({ routingProfileId: 'fast' })
    expect(store.routers[0]).not.toHaveProperty('profileId')
  })

  it('rewrites the retired balanced preset to auto', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    store.routers = [router({ profileId: 'balanced' })]

    await migrateProfiles()
    expect(store.routers[0]).toMatchObject({ routingProfileId: 'auto' })
  })

  it('leaves other retired ids alone, they stay resolvable as legacy builtins', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    store.routers = [router({ profileId: 'offline' })]

    await migrateProfiles()
    expect(store.routers[0]).toMatchObject({ routingProfileId: 'offline' })
  })

  it('an explicit routingProfileId wins over the legacy field', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    store.routers = [router({ profileId: 'fast', routingProfileId: 'cheap' })]

    await migrateProfiles()
    expect(store.routers[0]).toMatchObject({ routingProfileId: 'cheap' })
    expect(store.routers[0]).not.toHaveProperty('profileId')
  })

  it.each(['security-standard', 'security-strict'])('clears the deleted security preset %s', async (id) => {
    const { migrateProfiles } = await import('./migrate.js')
    store.routers = [router({ securityProfileId: id })]

    expect(await migrateProfiles()).toBe(1)
    expect(store.routers[0]).not.toHaveProperty('securityProfileId')
  })

  it('leaves a user-written security profile bound', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    store.routers = [router({ securityProfileId: 's1' })]

    expect(await migrateProfiles()).toBe(0)
    expect(store.routers[0]).toMatchObject({ securityProfileId: 's1' })
  })

  it('tags kind-less overlays as routing and remaps their baseId', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    store.profiles = [
      { id: 'o1', version: 3, label: 'Mine', builtin: false, baseId: 'balanced', policies: [], selector: 'argmax', fallbackStrategy: 'next-best' },
    ]

    expect(await migrateProfiles()).toBe(1)
    expect(store.profiles[0]).toMatchObject({ kind: 'routing', baseId: 'auto', version: 3 })
  })

  it('is idempotent: a second run rewrites nothing', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    const { writeConfig } = await import('../../config/loader.js')
    store.routers = [router({ profileId: 'balanced' })]
    store.profiles = [{ id: 'o1', version: 1, label: 'Mine', builtin: false, policies: [], selector: 'argmax', fallbackStrategy: 'next-best' }]

    await migrateProfiles()
    vi.mocked(writeConfig).mockClear()

    expect(await migrateProfiles()).toBe(0)
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('writes nothing when there is nothing to migrate', async () => {
    const { migrateProfiles } = await import('./migrate.js')
    const { writeConfig } = await import('../../config/loader.js')
    store.routers = [router({ routingProfileId: 'auto' })]

    expect(await migrateProfiles()).toBe(0)
    expect(writeConfig).not.toHaveBeenCalled()
  })
})
