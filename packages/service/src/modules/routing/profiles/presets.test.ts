import { describe, it, expect } from 'vitest'
import { BUILTIN_PROFILES, getBuiltin } from './presets.js'

const EXPECTED_IDS = ['balanced', 'cheap', 'fast', 'coding', 'offline']

describe('getBuiltin', () => {
  it('returns a frozen object for a known id', () => {
    const profile = getBuiltin('balanced')
    expect(profile).toBeDefined()
    expect(Object.isFrozen(profile)).toBe(true)
  })

  it('mutating the returned profile throws under strict mode', () => {
    const profile = getBuiltin('balanced')!
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
})

describe('BUILTIN_PROFILES', () => {
  it('contains all five presets with builtin === true', () => {
    expect(BUILTIN_PROFILES).toHaveLength(5)
    expect(BUILTIN_PROFILES.map(p => p.id).sort()).toEqual([...EXPECTED_IDS].sort())
    for (const profile of BUILTIN_PROFILES) {
      expect(profile.builtin).toBe(true)
      expect(Object.isFrozen(profile)).toBe(true)
    }
  })

  it('is itself frozen', () => {
    expect(Object.isFrozen(BUILTIN_PROFILES)).toBe(true)
  })

  it('matches the specified selector/fallback/policy shape per preset', () => {
    expect(getBuiltin('balanced')).toMatchObject({
      policies: [
        { type: 'health', enabled: true },
        { type: 'performance', enabled: true },
        { type: 'cheapest', enabled: true },
        { type: 'capability', enabled: true },
      ],
      selector: 'argmax',
      fallbackStrategy: 'next-best',
    })

    expect(getBuiltin('cheap')).toMatchObject({
      policies: [
        { type: 'cheapest', enabled: true },
        { type: 'budget-remaining', enabled: true },
        { type: 'health', enabled: true },
      ],
      selector: 'cheapest',
      fallbackStrategy: 'next-best',
    })

    expect(getBuiltin('fast')).toMatchObject({
      policies: [
        { type: 'performance', enabled: true },
        { type: 'health', enabled: true },
      ],
      selector: 'lowest-latency',
      fallbackStrategy: 'retry-after-cooldown',
    })

    expect(getBuiltin('coding')).toMatchObject({
      policies: [
        { type: 'capability', enabled: true },
        { type: 'model-preference', enabled: true },
        { type: 'performance', enabled: true },
        { type: 'health', enabled: true },
      ],
      selector: 'argmax',
      fallbackStrategy: 'next-best',
    })

    expect(getBuiltin('offline')).toMatchObject({
      policies: [
        { type: 'health', enabled: true },
        { type: 'cheapest', enabled: true },
      ],
      selector: 'round-robin',
      fallbackStrategy: 'abort',
    })
  })
})
