import { describe, it, expect } from 'vitest'
import { topologicalSort } from './graph.js'
import { DependencyCycleError, MissingDependencyError } from './errors.js'

describe('topologicalSort', () => {
  it('orders by dependsOn', () => {
    const order = topologicalSort([
      { id: 'b', dependsOn: ['a'] },
      { id: 'a' },
      { id: 'c', dependsOn: ['b'] },
    ])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('honors before/after relations', () => {
    const order = topologicalSort([
      { id: 'policy', after: ['candidates'] },
      { id: 'candidates' },
      { id: 'budget', before: ['policy'], after: ['candidates'] },
    ])
    expect(order.indexOf('candidates')).toBeLessThan(order.indexOf('budget'))
    expect(order.indexOf('budget')).toBeLessThan(order.indexOf('policy'))
  })

  it('uses weight as a stable tiebreak among ready nodes', () => {
    const order = topologicalSort([
      { id: 'late', weight: 10 },
      { id: 'early', weight: -10 },
      { id: 'mid' },
    ])
    expect(order).toEqual(['early', 'mid', 'late'])
  })

  it('throws on an unknown referenced id', () => {
    expect(() => topologicalSort([{ id: 'a', dependsOn: ['ghost'] }])).toThrow(
      MissingDependencyError,
    )
  })

  it('throws DependencyCycleError with the cycle', () => {
    try {
      topologicalSort([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ])
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(DependencyCycleError)
      expect((e as DependencyCycleError).cycle.length).toBeGreaterThan(0)
    }
  })

  it('detects multiple independent cycles and reports the offending set', () => {
    try {
      topologicalSort([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'x', dependsOn: ['y'] },
        { id: 'y', dependsOn: ['x'] },
        { id: 'root' },
      ])
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(DependencyCycleError)
      const cycle = (e as DependencyCycleError).cycle
      expect(cycle).not.toContain('root')
      expect(cycle.length).toBeGreaterThan(0)
    }
  })
})
