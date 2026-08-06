import { describe, it, expect, vi } from 'vitest'
import type { OptimizerProfile, Profile, RouterConfig, RoutingProfile, SecurityProfile } from '@routerly/shared'

let profilesFixture: Profile[] = []

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(async (key: string) => {
    if (key === 'profiles') return profilesFixture
    throw new Error(`unexpected readConfig key: ${key}`)
  }),
}))

function router(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    id: 'p1',
    name: 'Test',
    tokens: [],
    members: [],
    models: [],
    ...overrides,
  } as RouterConfig
}

const routingOverlay: RoutingProfile = {
  id: 'custom-1',
  kind: 'routing',
  version: 2,
  label: 'Custom',
  policies: [{ type: 'llm', enabled: true }],
  selector: 'argmax',
  fallbackStrategy: 'next-best',
  builtin: false,
  baseId: 'auto',
}

const optimizerOverlay: OptimizerProfile = {
  id: 'opt-1',
  kind: 'optimizer',
  version: 1,
  label: 'My optimizers',
  optimizers: { steps: [{ id: 'ccr', enabled: true }] },
  builtin: false,
}

const securityOverlay: SecurityProfile = {
  id: 'sec-1',
  kind: 'security',
  version: 1,
  label: 'My security',
  guardrails: { rules: [] },
  pii: { policies: [{ target: 'request', entities: ['EMAIL'] }] },
  builtin: false,
}

describe('resolveRoutingProfile', () => {
  it('a router with policies and no profile resolves to the custom profile carrying those policies', async () => {
    const { resolveRoutingProfile } = await import('./store.js')
    const policies = [{ type: 'cheapest' as const, enabled: true }]
    const resolved = await resolveRoutingProfile(router({ policies }))
    expect(resolved.id).toBe('custom')
    expect(resolved.builtin).toBe(false)
    expect(resolved.baseId).toBe('auto')
    expect(resolved.policies).toEqual(policies)
  })

  it('is idempotent: resolving twice yields identical output', async () => {
    const { resolveRoutingProfile } = await import('./store.js')
    const p = router({ policies: [{ type: 'health' as const, enabled: true }] })
    expect(await resolveRoutingProfile(p)).toEqual(await resolveRoutingProfile(p))
  })

  it('a router with no policies and no profile falls back to the auto preset policies', async () => {
    const { resolveRoutingProfile } = await import('./store.js')
    const { getBuiltin } = await import('./presets.js')
    const resolved = await resolveRoutingProfile(router())
    expect(resolved.policies).toEqual((getBuiltin('auto') as RoutingProfile).policies)
  })

  it('does not mutate the frozen builtin when deriving the custom profile', async () => {
    const { resolveRoutingProfile } = await import('./store.js')
    const { getBuiltin } = await import('./presets.js')
    const before = structuredClone((getBuiltin('auto') as RoutingProfile).policies)
    const resolved = await resolveRoutingProfile(router())
    resolved.policies.push({ type: 'fairness', enabled: true })
    expect((getBuiltin('auto') as RoutingProfile).policies).toEqual(before)
  })

  it('routingProfileId matching a user overlay returns that overlay, deep-cloned', async () => {
    profilesFixture = [routingOverlay]
    const { resolveRoutingProfile } = await import('./store.js')
    const resolved = await resolveRoutingProfile(router({ routingProfileId: 'custom-1' }))
    expect(resolved.id).toBe('custom-1')
    expect(resolved.version).toBe(2)
    resolved.policies.push({ type: 'health', enabled: true })
    expect((profilesFixture[0] as RoutingProfile).policies).toHaveLength(1)
    profilesFixture = []
  })

  it('the legacy profileId is still honoured when routingProfileId is absent', async () => {
    const { resolveRoutingProfile } = await import('./store.js')
    const resolved = await resolveRoutingProfile(router({ profileId: 'fast' }))
    expect(resolved.id).toBe('fast')
    expect(resolved.builtin).toBe(true)
  })

  it('an id matching neither an overlay nor a builtin falls back to the custom profile', async () => {
    const { resolveRoutingProfile } = await import('./store.js')
    const resolved = await resolveRoutingProfile(
      router({ routingProfileId: 'ghost', policies: [{ type: 'llm', enabled: true }] }),
    )
    expect(resolved.id).toBe('custom')
    expect(resolved.policies).toEqual([{ type: 'llm', enabled: true }])
  })

  it('ignores an id that resolves to a profile of another kind', async () => {
    profilesFixture = [optimizerOverlay]
    const { resolveRoutingProfile } = await import('./store.js')
    const resolved = await resolveRoutingProfile(router({ routingProfileId: 'opt-1' }))
    expect(resolved.id).toBe('custom')
    profilesFixture = []
  })
})

describe('resolveOptimizerProfile', () => {
  it('returns undefined when the router has neither a profile nor inline optimizers', async () => {
    const { resolveOptimizerProfile } = await import('./store.js')
    expect(await resolveOptimizerProfile(router())).toBeUndefined()
  })

  it('wraps inline optimizers in the ephemeral custom profile', async () => {
    const { resolveOptimizerProfile } = await import('./store.js')
    const optimizers = { steps: [{ id: 'rtk' as const, enabled: true }] }
    const resolved = await resolveOptimizerProfile(router({ optimizers }))
    expect(resolved?.id).toBe('custom')
    expect(resolved?.optimizers).toEqual(optimizers)
  })

  it('a bound profile wins over inline optimizers', async () => {
    profilesFixture = [optimizerOverlay]
    const { resolveOptimizerProfile } = await import('./store.js')
    const resolved = await resolveOptimizerProfile(
      router({ optimizerProfileId: 'opt-1', optimizers: { steps: [{ id: 'rtk', enabled: true }] } }),
    )
    expect(resolved?.id).toBe('opt-1')
    expect(resolved?.optimizers.steps.map(s => s.id)).toEqual(['ccr'])
    profilesFixture = []
  })
})

describe('resolveSecurityProfile', () => {
  it('returns undefined when the router has no guardrails and no pii config', async () => {
    const { resolveSecurityProfile } = await import('./store.js')
    expect(await resolveSecurityProfile(router())).toBeUndefined()
  })

  it('fills the missing half when only one of guardrails/pii is set inline', async () => {
    const { resolveSecurityProfile } = await import('./store.js')
    const resolved = await resolveSecurityProfile(router({ guardrails: { rules: [] } }))
    expect(resolved?.id).toBe('custom')
    expect(resolved?.pii).toEqual({ policies: [] })
  })

  it('a bound profile wins over inline config', async () => {
    profilesFixture = [securityOverlay]
    const { resolveSecurityProfile } = await import('./store.js')
    const resolved = await resolveSecurityProfile(router({ securityProfileId: 'sec-1', pii: { policies: [] } }))
    expect(resolved?.id).toBe('sec-1')
    expect(resolved?.pii.policies).toHaveLength(1)
    profilesFixture = []
  })
})

describe('applyProfiles', () => {
  it('returns the very same object when the router binds no profile', async () => {
    const { applyProfiles } = await import('./store.js')
    const p = router({ optimizers: { steps: [{ id: 'rtk', enabled: true }] } })
    expect(await applyProfiles(p)).toBe(p)
  })

  it('replaces inline optimizer and security config with the bound profiles', async () => {
    profilesFixture = [optimizerOverlay, securityOverlay]
    const { applyProfiles } = await import('./store.js')
    const applied = await applyProfiles(
      router({
        optimizerProfileId: 'opt-1',
        securityProfileId: 'sec-1',
        optimizers: { steps: [{ id: 'rtk', enabled: true }] },
        pii: { policies: [] },
      }),
    )
    expect(applied.optimizers?.steps.map(s => s.id)).toEqual(['ccr'])
    expect(applied.pii?.policies).toHaveLength(1)
    profilesFixture = []
  })

  it('leaves routing alone: the router resolves its own profile', async () => {
    profilesFixture = [routingOverlay]
    const { applyProfiles } = await import('./store.js')
    const policies = [{ type: 'cheapest' as const, enabled: true }]
    const applied = await applyProfiles(router({ routingProfileId: 'custom-1', policies }))
    expect(applied.policies).toEqual(policies)
    profilesFixture = []
  })
})

describe('cloneProfile', () => {
  it('clones auto into a distinct, non-builtin, version-1 user profile', async () => {
    const { cloneProfile } = await import('./store.js')
    const clone = await cloneProfile('auto', 'My Auto')
    expect(clone.builtin).toBe(false)
    expect(clone.baseId).toBe('auto')
    expect(clone.id).not.toBe('auto')
    expect(clone.version).toBe(1)
    expect(clone.label).toBe('My Auto')
    expect(clone.kind).toBe('routing')
  })

  it('clones a preset of any kind, keeping its payload', async () => {
    const { cloneProfile } = await import('./store.js')
    const clone = await cloneProfile('optimizer-balanced', 'My Balanced')
    expect(clone.kind).toBe('optimizer')
    expect((clone as OptimizerProfile).optimizers.steps.length).toBeGreaterThan(0)
  })

  it('deep-clones the payload, mutation does not affect the builtin preset', async () => {
    const { cloneProfile } = await import('./store.js')
    const { getBuiltin } = await import('./presets.js')
    const before = structuredClone((getBuiltin('auto') as RoutingProfile).policies)
    const clone = (await cloneProfile('auto', 'Mutate me')) as RoutingProfile
    clone.policies.push({ type: 'fairness', enabled: true })
    clone.policies[0]!.enabled = false
    expect((getBuiltin('auto') as RoutingProfile).policies).toEqual(before)
  })

  it('clones a user overlay too, not just presets', async () => {
    profilesFixture = [routingOverlay]
    const { cloneProfile } = await import('./store.js')
    const clone = await cloneProfile('custom-1', 'Copy')
    expect(clone.baseId).toBe('custom-1')
    expect(clone.version).toBe(1)
    profilesFixture = []
  })

  it('throws for an unknown baseId', async () => {
    const { cloneProfile } = await import('./store.js')
    await expect(cloneProfile('does-not-exist', 'x')).rejects.toThrow('unknown_base_profile')
  })
})

describe('bumpVersion', () => {
  it('increments version without mutating the input', async () => {
    const { bumpVersion } = await import('./store.js')
    const bumped = bumpVersion(routingOverlay)
    expect(bumped.version).toBe(3)
    expect(routingOverlay.version).toBe(2)
  })
})

describe('listProfiles', () => {
  it('returns builtins followed by user overlays', async () => {
    profilesFixture = [optimizerOverlay]
    const { listProfiles } = await import('./store.js')
    const { BUILTIN_PROFILES } = await import('./presets.js')
    const all = await listProfiles()
    expect(all).toHaveLength(BUILTIN_PROFILES.length + 1)
    expect(all.slice(0, BUILTIN_PROFILES.length).map(p => p.id)).toEqual(BUILTIN_PROFILES.map(p => p.id))
    expect(all[all.length - 1]!.id).toBe('opt-1')
    profilesFixture = []
  })

  it('narrows to one kind, overlays included', async () => {
    profilesFixture = [routingOverlay, optimizerOverlay]
    const { listProfiles } = await import('./store.js')
    const optimizers = await listProfiles('optimizer')
    expect(optimizers.every(p => p.kind === 'optimizer')).toBe(true)
    expect(optimizers.map(p => p.id)).toContain('opt-1')
    expect(optimizers.map(p => p.id)).not.toContain('custom-1')
    profilesFixture = []
  })

  it('never lists legacy presets', async () => {
    const { listProfiles } = await import('./store.js')
    expect((await listProfiles()).map(p => p.id)).not.toContain('balanced')
  })

  it('the returned builtin entries are mutable copies, not the frozen singletons', async () => {
    const { listProfiles } = await import('./store.js')
    const auto = (await listProfiles()).find(p => p.id === 'auto') as RoutingProfile
    expect(() => {
      auto.label = 'Hacked'
    }).not.toThrow()
    expect(Object.isFrozen(auto.policies)).toBe(false)
  })
})

describe('assertWritableProfile', () => {
  it('rejects a profile marked builtin', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() => assertWritableProfile({ ...routingOverlay, id: 'anything', builtin: true })).toThrow(
      'immutable_builtin_profile',
    )
  })

  it('rejects a same-id override of a builtin even when builtin is false', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() => assertWritableProfile({ ...routingOverlay, id: 'auto' })).toThrow('immutable_builtin_profile')
  })

  it('rejects a same-id override of a legacy builtin', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() => assertWritableProfile({ ...routingOverlay, id: 'balanced' })).toThrow('immutable_builtin_profile')
  })

  it('rejects squatting on the ephemeral custom id', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() => assertWritableProfile({ ...routingOverlay, id: 'custom' })).toThrow('immutable_builtin_profile')
  })

  it('allows a genuine user profile', async () => {
    const { assertWritableProfile } = await import('./store.js')
    expect(() => assertWritableProfile(routingOverlay)).not.toThrow()
  })
})
