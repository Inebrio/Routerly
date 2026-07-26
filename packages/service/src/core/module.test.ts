import { describe, it, expect } from 'vitest'
import { defineModule } from './module.js'
import { KernelError } from './errors.js'

describe('defineModule', () => {
  it('returns the module unchanged when the manifest is valid', () => {
    const mod = defineModule({
      manifest: { id: 'routing', version: '1.0.0' },
      register() {},
    })
    expect(mod.manifest.id).toBe('routing')
  })

  it('throws on an empty id or version', () => {
    expect(() =>
      defineModule({ manifest: { id: '', version: '1.0.0' }, register() {} }),
    ).toThrow(KernelError)
    expect(() =>
      defineModule({ manifest: { id: 'x', version: '' }, register() {} }),
    ).toThrow(KernelError)
  })
})
