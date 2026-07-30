import { describe, it, expect } from 'vitest'
import type { OptimizerId } from '@routerly/shared'
import { OptimizerRegistry, type Optimizer } from './registry.js'

function fakeOpt(id: OptimizerId): Optimizer {
  return {
    id,
    klass: 'lossless',
    supports: () => true,
    estimate: () => ({ estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    optimize: () => ({ changed: false, estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    validate: () => true,
  }
}

describe('OptimizerRegistry', () => {
  it('registers optimizers and returns them via get/list', () => {
    const reg = new OptimizerRegistry()
    const a = fakeOpt('session-dedup')
    const b = fakeOpt('ccr')
    reg.register(a)
    reg.register(b)
    expect(reg.get('session-dedup')).toBe(a)
    expect(reg.get('ccr')).toBe(b)
    expect(reg.list()).toEqual([a, b])
  })

  it('returns undefined for an unregistered id', () => {
    const reg = new OptimizerRegistry()
    expect(reg.get('rtk')).toBeUndefined()
  })

  it('throws on a duplicate id', () => {
    const reg = new OptimizerRegistry()
    reg.register(fakeOpt('session-dedup'))
    expect(() => reg.register(fakeOpt('session-dedup'))).toThrow(/session-dedup/)
  })
})
