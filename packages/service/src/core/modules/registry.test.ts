import { describe, it, expect } from 'vitest'
import type { ModuleManifest, RouterlyModule } from './index.js'
import { PRODUCT_VERSION } from '../version.js'
import {
  isAlwaysOn,
  isModuleEnabled,
  resolveEnabledModules,
  filterEnabledModules,
} from './registry.js'

const all: ModuleManifest[] = [
  { id: 'config', version: PRODUCT_VERSION },
  { id: 'routing', version: PRODUCT_VERSION },
  { id: 'guardrails', version: PRODUCT_VERSION },
  { id: 'provider-web', version: PRODUCT_VERSION },
]

describe('registry: every module is core and always active', () => {
  it('treats every id as always-on', () => {
    expect(isAlwaysOn('config')).toBe(true)
    expect(isAlwaysOn('provider-web')).toBe(true)
  })

  it('ignores stored enabled:false records', () => {
    expect(isModuleEnabled([{ id: 'provider-web', enabled: false }], 'provider-web')).toBe(true)
    expect(isModuleEnabled([{ id: 'guardrails', enabled: false }], 'guardrails')).toBe(true)
  })

  it('resolveEnabledModules keeps all modules', () => {
    const out = resolveEnabledModules([{ id: 'guardrails', enabled: false }], all).map((m) => m.id)
    expect(out).toEqual(['config', 'routing', 'guardrails', 'provider-web'])
  })

  it('filterEnabledModules keeps all modules', () => {
    const mods = all.map((manifest) => ({ manifest }) as RouterlyModule)
    expect(filterEnabledModules([{ id: 'guardrails', enabled: false }], mods)).toHaveLength(4)
  })
})
