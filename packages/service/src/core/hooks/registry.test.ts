import { describe, it, expect } from 'vitest'
import { AlterableRegistry } from './registry.js'
import { KernelError, MissingDependencyError } from '../errors.js'

describe('AlterableRegistry', () => {
  it('orders contributions by weight then before/after', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'b', value: 'B', after: ['a'] })
    reg.contribute({ id: 'a', value: 'A' })
    reg.contribute({ id: 'c', value: 'C', after: ['a'], before: ['b'] })
    expect(reg.ordered()).toEqual(['A', 'C', 'B'])
  })

  it('overrides an existing contribution value by id', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A' })
    reg.override('a', (prev) => prev + '!')
    expect(reg.ordered()).toEqual(['A!'])
  })

  it('throws MissingDependencyError when overriding an unknown id', () => {
    const reg = new AlterableRegistry<string>()
    expect(() => reg.override('missing', (v) => v)).toThrow(MissingDependencyError)
  })

  it('throws KernelError on duplicate contribution id', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A' })
    expect(() => reg.contribute({ id: 'a', value: 'A2' })).toThrow(KernelError)
  })

  it('silently drops before/after references to ids outside this registry', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A', after: ['outside-this-registry'] })
    expect(reg.ordered()).toEqual(['A'])
  })
})
