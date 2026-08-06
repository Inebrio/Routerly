import { describe, it, expect } from 'vitest'
import type { ModuleManifest, RouterlyModule } from './index.js'
import { PRODUCT_VERSION } from '../version.js'
import {
  isAlwaysOn,
  isModuleEnabled,
  resolveEnabledModules,
  filterEnabledModules,
  canEnable,
  canDisable,
  setModuleEnabled,
  ALWAYS_ON_MODULE_IDS,
} from './registry.js'

const all: ModuleManifest[] = [
  { id: 'config', version: PRODUCT_VERSION },
  { id: 'reverse-proxy', version: PRODUCT_VERSION },
  { id: 'routing', version: PRODUCT_VERSION, dependsOn: { 'reverse-proxy': `^${PRODUCT_VERSION}` } },
  { id: 'guardrails', version: PRODUCT_VERSION, dependsOn: { 'reverse-proxy': `^${PRODUCT_VERSION}` } },
  { id: 'cache', version: PRODUCT_VERSION, dependsOn: { 'reverse-proxy': `^${PRODUCT_VERSION}` } },
]

describe('registry', () => {
  it('treats infra ids as always-on', () => {
    expect(isAlwaysOn('config')).toBe(true)
    expect(isAlwaysOn('reverse-proxy')).toBe(true)
    expect(isAlwaysOn('guardrails')).toBe(false)
    expect(ALWAYS_ON_MODULE_IDS).toContain('routing')
    expect(ALWAYS_ON_MODULE_IDS).toContain('api')
  })

  it('enables modules by default when no record exists', () => {
    expect(isModuleEnabled([], 'guardrails')).toBe(true)
  })

  it('disables a module only via explicit record', () => {
    expect(isModuleEnabled([{ id: 'guardrails', enabled: false }], 'guardrails')).toBe(false)
  })

  it('never disables an always-on module even with a record', () => {
    expect(isModuleEnabled([{ id: 'config', enabled: false }], 'config')).toBe(true)
  })

  it('resolveEnabledModules drops explicitly disabled modules', () => {
    const out = resolveEnabledModules([{ id: 'guardrails', enabled: false }], all).map((m) => m.id)
    expect(out).toEqual(['config', 'reverse-proxy', 'routing', 'cache'])
  })

  it('canDisable rejects always-on', () => {
    expect(canDisable('config', [], all)).toEqual({
      ok: false,
      error: 'Module "config" is always-on and cannot be disabled',
    })
  })

  it('canDisable rejects unknown module', () => {
    expect(canDisable('nope', [], all).ok).toBe(false)
  })

  it('canDisable allows a leaf feature module', () => {
    expect(canDisable('guardrails', [], all)).toEqual({ ok: true })
  })

  it('canEnable rejects when a dependency is disabled', () => {
    const records = [{ id: 'cache', enabled: false }]
    // fabricate a manifest that depends on cache
    const withDep: ModuleManifest[] = [...all, { id: 'x', version: '0.4.0', dependsOn: { cache: '^0.4.0' } }]
    expect(canEnable('x', records, withDep).ok).toBe(false)
  })

  it('canEnable allows when deps are enabled', () => {
    expect(canEnable('guardrails', [], all)).toEqual({ ok: true })
  })

  it('setModuleEnabled upserts a single record', () => {
    const r1 = setModuleEnabled([], 'guardrails', false)
    expect(r1).toEqual([{ id: 'guardrails', enabled: false }])
    const r2 = setModuleEnabled(r1, 'guardrails', true)
    expect(r2).toEqual([{ id: 'guardrails', enabled: true }])
  })

  it('filterEnabledModules drops modules whose record disables them', () => {
    const modules: RouterlyModule[] = [
      { manifest: { id: 'reverse-proxy', version: '0.4.0' }, register: () => {} },
      { manifest: { id: 'guardrails', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }, register: () => {} },
      { manifest: { id: 'cache', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }, register: () => {} },
    ]
    const out = filterEnabledModules([{ id: 'guardrails', enabled: false }], modules).map((m) => m.manifest.id)
    expect(out).toEqual(['reverse-proxy', 'cache'])
  })

  it('canDisable rejects when another enabled module depends on it', () => {
    const withChain: ModuleManifest[] = [
      ...all,
      { id: 'leaf', version: '0.4.0' },
      { id: 'branch', version: '0.4.0', dependsOn: { leaf: '^0.4.0' } },
    ]
    expect(canDisable('leaf', [], withChain)).toEqual({
      ok: false,
      error: 'Cannot disable "leaf": required by branch',
    })
  })

  it('canEnable rejects unknown module', () => {
    expect(canEnable('nope', [], all)).toEqual({ ok: false, error: 'Unknown module "nope"' })
  })

  it('canEnable allows a module with no declared dependencies', () => {
    expect(canEnable('config', [], all)).toEqual({ ok: true })
  })
})
