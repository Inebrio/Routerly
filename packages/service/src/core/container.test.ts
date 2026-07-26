import { describe, it, expect } from 'vitest'
import { ServiceContainer, token } from './container.js'
import { MissingDependencyError, KernelError } from './errors.js'

interface Clock {
  now(): number
}
const CLOCK = token<Clock>('clock')

describe('ServiceContainer', () => {
  it('registers and resolves a typed service', () => {
    const c = new ServiceContainer()
    c.register(CLOCK, { now: () => 7 })
    expect(c.resolve(CLOCK).now()).toBe(7)
    expect(c.has(CLOCK)).toBe(true)
  })

  it('throws MissingDependencyError on unknown token', () => {
    const c = new ServiceContainer()
    expect(c.has(CLOCK)).toBe(false)
    expect(() => c.resolve(CLOCK)).toThrow(MissingDependencyError)
    expect(c.tryResolve(CLOCK)).toBeUndefined()
  })

  it('rejects duplicate registration of the same key', () => {
    const c = new ServiceContainer()
    c.register(CLOCK, { now: () => 1 })
    expect(() => c.register(CLOCK, { now: () => 2 })).toThrow(KernelError)
  })
})
