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

  it('overrides a registered service by decorating the previous value', () => {
    const clock = token<{ now(): number }>('clock')
    const c = new ServiceContainer()
    c.register(clock, { now: () => 1 })
    c.override(clock, (prev) => ({ now: () => prev.now() + 10 }))
    expect(c.resolve(clock).now()).toBe(11)
  })

  it('composes multiple overrides in registration order', () => {
    const clock = token<{ now(): number }>('clock')
    const c = new ServiceContainer()
    c.register(clock, { now: () => 1 })
    c.override(clock, (prev) => ({ now: () => prev.now() + 1 }))
    c.override(clock, (prev) => ({ now: () => prev.now() * 10 }))
    expect(c.resolve(clock).now()).toBe(20)
  })

  it('throws MissingDependencyError when overriding an unregistered token', () => {
    const clock = token<{ now(): number }>('clock')
    const c = new ServiceContainer()
    expect(() => c.override(clock, (prev) => prev)).toThrow(MissingDependencyError)
  })
})
