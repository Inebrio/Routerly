import { describe, it, expect } from 'vitest'
import { shortCircuit, isShortCircuit } from './result.js'
import {
  KernelError,
  ModuleGraphError,
  MissingDependencyError,
  DependencyCycleError,
} from './errors.js'

describe('result', () => {
  it('wraps a value in a short-circuit', () => {
    const sc = shortCircuit(42)
    expect(sc.kind).toBe('short-circuit')
    expect(sc.result).toBe(42)
  })

  it('recognizes a short-circuit and rejects other values', () => {
    expect(isShortCircuit(shortCircuit('x'))).toBe(true)
    expect(isShortCircuit(null)).toBe(false)
    expect(isShortCircuit({ kind: 'other' })).toBe(false)
    expect(isShortCircuit(42)).toBe(false)
  })
})

describe('errors', () => {
  it('KernelError carries a code and is an Error', () => {
    const e = new KernelError('boom', 'X')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('X')
    expect(e.message).toBe('boom')
    expect(e.name).toBe('KernelError')
  })

  it('subclasses set their fixed codes and names', () => {
    expect(new ModuleGraphError('m').code).toBe('MODULE_GRAPH')
    expect(new ModuleGraphError('m').name).toBe('ModuleGraphError')
    expect(new MissingDependencyError('d').code).toBe('MISSING_DEPENDENCY')
    const cyc = new DependencyCycleError('c', ['a', 'b', 'a'])
    expect(cyc.code).toBe('DEPENDENCY_CYCLE')
    expect(cyc.cycle).toEqual(['a', 'b', 'a'])
  })
})
