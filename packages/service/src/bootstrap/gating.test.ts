import { describe, it, expect } from 'vitest'
import { ALL_MODULES } from '../modules/index.js'
import { filterEnabledModules } from '../core/modules/registry.js'

describe('bootstrap gating', () => {
  it('exposes the full static module list including infra + core', () => {
    const ids = ALL_MODULES.map((m) => m.manifest.id)
    expect(ids).toContain('config')
    expect(ids).toContain('reverse-proxy')
    expect(ids).toContain('guardrails')
    expect(ids).toContain('cache')
  })

  it('a disabled feature module is filtered out of the kernel list', () => {
    const kept = filterEnabledModules([{ id: 'guardrails', enabled: false }], ALL_MODULES).map(
      (m) => m.manifest.id,
    )
    expect(kept).not.toContain('guardrails')
    expect(kept).toContain('reverse-proxy')
  })

  it('an always-on module cannot be filtered out', () => {
    const kept = filterEnabledModules([{ id: 'config', enabled: false }], ALL_MODULES).map(
      (m) => m.manifest.id,
    )
    expect(kept).toContain('config')
  })
})
