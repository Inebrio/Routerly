import { describe, it, expect, vi } from 'vitest'
import type { ProjectConfig, RoutingProfile } from '@routerly/shared'

let profilesFixture: RoutingProfile[] = []

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(async (key: string) => {
    if (key === 'profiles') return profilesFixture
    throw new Error(`unexpected readConfig key: ${key}`)
  }),
}))

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'p1',
    name: 'Test',
    tokens: [],
    members: [],
    models: [],
    ...overrides,
  } as ProjectConfig
}

describe('resolveProfile', () => {
  it('a project with policies and no profileId resolves to the default profile carrying those policies', async () => {
    const { resolveProfile } = await import('./store.js')
    const policies = [{ type: 'cheapest' as const, enabled: true }]
    const resolved = await resolveProfile(project({ policies }))
    expect(resolved.id).toBe('default')
    expect(resolved.builtin).toBe(false)
    expect(resolved.baseId).toBe('balanced')
    expect(resolved.policies).toEqual(policies)
  })

  it('is idempotent: resolving twice yields identical output', async () => {
    const { resolveProfile } = await import('./store.js')
    const policies = [{ type: 'health' as const, enabled: true }]
    const p = project({ policies })
    const first = await resolveProfile(p)
    const second = await resolveProfile(p)
    expect(first).toEqual(second)
  })

  it('a project with no policies and no profileId falls back to balanced policies', async () => {
    const { resolveProfile } = await import('./store.js')
    const resolved = await resolveProfile(project())
    const { getBuiltin } = await import('./presets.js')
    expect(resolved.policies).toEqual(getBuiltin('balanced')!.policies)
  })

  it('does not mutate the frozen builtin when deriving the default profile', async () => {
    const { resolveProfile } = await import('./store.js')
    const { getBuiltin } = await import('./presets.js')
    const balancedBefore = JSON.parse(JSON.stringify(getBuiltin('balanced')!.policies))
    const resolved = await resolveProfile(project())
    resolved.policies.push({ type: 'fairness', enabled: true })
    expect(getBuiltin('balanced')!.policies).toEqual(balancedBefore)
  })

  it('a profileId matching a user overlay returns that overlay, deep-cloned', async () => {
    profilesFixture = [
      {
        id: 'custom-1',
        version: 2,
        label: 'Custom',
        policies: [{ type: 'llm', enabled: true }],
        selector: 'argmax',
        fallbackStrategy: 'next-best',
        builtin: false,
        baseId: 'balanced',
      },
    ]
    const { resolveProfile } = await import('./store.js')
    const resolved = await resolveProfile(project({ profileId: 'custom-1' }))
    expect(resolved.id).toBe('custom-1')
    expect(resolved.version).toBe(2)
    resolved.policies.push({ type: 'health', enabled: true })
    expect(profilesFixture[0]!.policies).toHaveLength(1)
    profilesFixture = []
  })

  it('a profileId matching a builtin returns that builtin, deep-cloned', async () => {
    const { resolveProfile } = await import('./store.js')
    const resolved = await resolveProfile(project({ profileId: 'fast' }))
    expect(resolved.id).toBe('fast')
    expect(resolved.builtin).toBe(true)
  })

  it('a profileId matching neither a user overlay nor a builtin falls back to the default profile', async () => {
    const { resolveProfile } = await import('./store.js')
    const resolved = await resolveProfile(project({ profileId: 'ghost', policies: [{ type: 'llm', enabled: true }] }))
    expect(resolved.id).toBe('default')
    expect(resolved.policies).toEqual([{ type: 'llm', enabled: true }])
  })
})

describe('cloneProfile', () => {
  it('clones balanced into a distinct, non-builtin, version-1 user profile', async () => {
    const { cloneProfile } = await import('./store.js')
    const clone = cloneProfile('balanced', 'My Balanced')
    expect(clone.builtin).toBe(false)
    expect(clone.baseId).toBe('balanced')
    expect(clone.id).not.toBe('balanced')
    expect(clone.version).toBe(1)
    expect(clone.label).toBe('My Balanced')
  })

  it('deep-clones policies, mutation does not affect the builtin preset', async () => {
    const { cloneProfile } = await import('./store.js')
    const { getBuiltin } = await import('./presets.js')
    const before = JSON.parse(JSON.stringify(getBuiltin('balanced')!.policies))
    const clone = cloneProfile('balanced', 'Mutate me')
    clone.policies.push({ type: 'fairness', enabled: true })
    clone.policies[0]!.enabled = false
    expect(getBuiltin('balanced')!.policies).toEqual(before)
  })

  it('throws for an unknown baseId', async () => {
    const { cloneProfile } = await import('./store.js')
    expect(() => cloneProfile('does-not-exist', 'x')).toThrow()
  })
})

describe('bumpVersion', () => {
  it('increments version without mutating the input', async () => {
    const { bumpVersion } = await import('./store.js')
    const profile: RoutingProfile = {
      id: 'x',
      version: 1,
      label: 'X',
      policies: [],
      selector: 'argmax',
      fallbackStrategy: 'next-best',
      builtin: false,
    }
    const bumped = bumpVersion(profile)
    expect(bumped.version).toBe(2)
    expect(profile.version).toBe(1)
  })
})

describe('listProfiles', () => {
  it('returns builtins followed by user overlays', async () => {
    profilesFixture = [
      {
        id: 'custom-2',
        version: 1,
        label: 'Overlay',
        policies: [],
        selector: 'argmax',
        fallbackStrategy: 'next-best',
        builtin: false,
      },
    ]
    const { listProfiles } = await import('./store.js')
    const { BUILTIN_PROFILES } = await import('./presets.js')
    const all = await listProfiles()
    expect(all).toHaveLength(BUILTIN_PROFILES.length + 1)
    expect(all.slice(0, BUILTIN_PROFILES.length).map(p => p.id)).toEqual(BUILTIN_PROFILES.map(p => p.id))
    expect(all[all.length - 1]!.id).toBe('custom-2')
    profilesFixture = []
  })

  it('the returned builtin entries are mutable copies, not the frozen singletons', async () => {
    const { listProfiles } = await import('./store.js')
    const all = await listProfiles()
    const balanced = all.find(p => p.id === 'balanced')!
    expect(() => {
      balanced.label = 'Hacked'
    }).not.toThrow()
    expect(Object.isFrozen(balanced.policies)).toBe(false)
  })
})

describe('assertWritableProfile', () => {
  it('rejects a profile marked builtin', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() =>
      assertWritableProfile({
        id: 'anything',
        version: 1,
        label: 'X',
        policies: [],
        selector: 'argmax',
        fallbackStrategy: 'next-best',
        builtin: true,
      }),
    ).toThrow('immutable_builtin_profile')
  })

  it('rejects a same-id override of a builtin even when builtin is false', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() =>
      assertWritableProfile({
        id: 'balanced',
        version: 1,
        label: 'Fake Balanced',
        policies: [],
        selector: 'argmax',
        fallbackStrategy: 'next-best',
        builtin: false,
      }),
    ).toThrow('immutable_builtin_profile')
  })

  it('allows a genuine user profile', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() =>
      assertWritableProfile({
        id: 'custom-3',
        version: 1,
        label: 'Custom',
        policies: [],
        selector: 'argmax',
        fallbackStrategy: 'next-best',
        builtin: false,
      }),
    ).not.toThrow()
  })
})
