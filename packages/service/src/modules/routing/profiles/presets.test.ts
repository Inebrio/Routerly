import { describe, it, expect } from 'vitest'
import type { RoutingProfile } from '@routerly/shared'
import { BUILTIN_PROFILES, LEGACY_BUILTIN_PROFILES, DEFAULT_PROFILE_ID, getBuiltin, listBuiltins } from './presets.js'

const ROUTING_IDS = ['auto', 'cheap', 'fast', 'coding']
const OPTIMIZER_IDS = ['optimizer-safe', 'optimizer-balanced', 'optimizer-aggressive']
const EXPECTED_IDS = [...ROUTING_IDS, ...OPTIMIZER_IDS]

const routing = (id: string): RoutingProfile => getBuiltin(id) as RoutingProfile

describe('getBuiltin', () => {
  it('returns a frozen object for a known id', () => {
    expect(Object.isFrozen(getBuiltin('auto'))).toBe(true)
  })

  it('mutating the returned profile throws under strict mode', () => {
    const profile = getBuiltin('auto')!
    expect(() => {
      profile.label = 'Hacked'
    }).toThrow()
  })

  it('returns undefined for an unknown id', () => {
    expect(getBuiltin('does-not-exist')).toBeUndefined()
  })

  it.each(EXPECTED_IDS)('has a builtin preset for id %s', (id) => {
    const profile = getBuiltin(id)
    expect(profile).toBeDefined()
    expect(profile!.id).toBe(id)
    expect(profile!.builtin).toBe(true)
    expect(profile!.version).toBe(1)
  })

  it.each(['balanced', 'offline'])('still resolves the retired preset %s', (id) => {
    expect(getBuiltin(id)?.id).toBe(id)
  })
})

describe('BUILTIN_PROFILES', () => {
  it('contains every current preset with builtin === true', () => {
    expect(BUILTIN_PROFILES.map(p => p.id).sort()).toEqual([...EXPECTED_IDS].sort())
    for (const profile of BUILTIN_PROFILES) {
      expect(profile.builtin).toBe(true)
      expect(Object.isFrozen(profile)).toBe(true)
    }
  })

  it('is itself frozen', () => {
    expect(Object.isFrozen(BUILTIN_PROFILES)).toBe(true)
  })

  it('excludes the retired presets', () => {
    expect(BUILTIN_PROFILES.map(p => p.id)).not.toContain('balanced')
    expect(BUILTIN_PROFILES.map(p => p.id)).not.toContain('offline')
  })

  it('has a default preset per kind, and each one exists', () => {
    for (const [kind, id] of Object.entries(DEFAULT_PROFILE_ID)) {
      expect(getBuiltin(id)?.kind).toBe(kind)
    }
  })

  it('matches the specified selector/fallback/policy shape per routing preset', () => {
    expect(routing('auto')).toMatchObject({
      policies: [
        { type: 'health', enabled: true },
        { type: 'performance', enabled: true },
        { type: 'cheapest', enabled: true },
        { type: 'capability', enabled: true },
      ],
      selector: 'argmax',
      fallbackStrategy: 'next-best',
    })

    expect(routing('cheap')).toMatchObject({
      policies: [
        { type: 'cheapest', enabled: true },
        { type: 'budget-remaining', enabled: true },
        { type: 'health', enabled: true },
      ],
      selector: 'cheapest',
      fallbackStrategy: 'next-best',
    })

    expect(routing('fast')).toMatchObject({
      policies: [
        { type: 'performance', enabled: true },
        { type: 'health', enabled: true },
      ],
      selector: 'lowest-latency',
      fallbackStrategy: 'retry-after-cooldown',
    })

    expect(routing('coding')).toMatchObject({
      policies: [
        { type: 'capability', enabled: true },
        { type: 'model-preference', enabled: true },
        { type: 'performance', enabled: true },
        { type: 'health', enabled: true },
      ],
      selector: 'argmax',
      fallbackStrategy: 'next-best',
    })

    expect(routing('offline')).toMatchObject({
      policies: [
        { type: 'health', enabled: true },
        { type: 'cheapest', enabled: true },
      ],
      selector: 'round-robin',
      fallbackStrategy: 'abort',
    })
  })

  // The migration rewrites balanced -> auto without touching routing behaviour,
  // which only holds while the two are identical apart from id and label.
  it('auto is a drop-in replacement for the retired balanced preset', () => {
    const { id: _bid, label: _blabel, ...balanced } = routing('balanced')
    const { id: _aid, label: _alabel, ...auto } = routing('auto')
    expect(auto).toEqual(balanced)
  })

  it('optimizer presets are cumulative from safe to aggressive', () => {
    const steps = (id: string) =>
      (listBuiltins('optimizer').find(p => p.id === id) as { optimizers: { steps: { id: string }[] } }).optimizers.steps.map(s => s.id)
    const safe = steps('optimizer-safe')
    const balanced = steps('optimizer-balanced')
    const aggressive = steps('optimizer-aggressive')
    expect(balanced.slice(0, safe.length)).toEqual(safe)
    expect(aggressive.slice(0, balanced.length)).toEqual(balanced)
  })

  // Guardrails and PII rewrite the request, so no router may inherit them from
  // a preset it never chose: security profiles are user-written only.
  it('ships no security preset', () => {
    expect(listBuiltins('security')).toEqual([])
    expect(getBuiltin('security-standard')).toBeUndefined()
    expect(getBuiltin('security-strict')).toBeUndefined()
  })
})

describe('listBuiltins', () => {
  it.each([
    ['routing', ROUTING_IDS],
    ['optimizer', OPTIMIZER_IDS],
    ['security', []],
  ] as const)('returns only the %s presets', (kind, ids) => {
    expect(listBuiltins(kind).map(p => p.id)).toEqual(ids)
  })

  it('never returns a retired preset', () => {
    const listed = (['routing', 'optimizer', 'security'] as const).flatMap(k => listBuiltins(k).map(p => p.id))
    for (const legacy of LEGACY_BUILTIN_PROFILES) {
      expect(listed).not.toContain(legacy.id)
    }
  })
})
