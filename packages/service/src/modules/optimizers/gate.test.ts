import { describe, it, expect } from 'vitest'
import type { OptimizerResult } from '@routerly/shared'
import { passesSafetyGate } from './gate.js'

function result(over: Partial<OptimizerResult>): OptimizerResult {
  return { changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 100, ...over }
}

describe('passesSafetyGate', () => {
  it('rejects over-compression below the floor ratio', () => {
    expect(passesSafetyGate(result({ estimatedTokensAfter: 10 }), { floorRatio: 0.2 })).toBe(false)
  })

  it('rejects a changed result with empty output', () => {
    expect(
      passesSafetyGate(
        result({ estimatedTokensBefore: 0, estimatedTokensAfter: 0, note: 'empty output' }),
        { floorRatio: 0.2 },
      ),
    ).toBe(false)
  })

  it('accepts a moderate reduction above the floor', () => {
    expect(passesSafetyGate(result({ estimatedTokensAfter: 70 }), { floorRatio: 0.2 })).toBe(true)
  })

  it('accepts an unchanged result (nothing to gate)', () => {
    expect(passesSafetyGate(result({ changed: false, estimatedTokensAfter: 0 }), {})).toBe(true)
  })

  it('uses a default floor ratio when opts omit it', () => {
    // default floor 0.2: after/before = 0.05 -> reject
    expect(passesSafetyGate(result({ estimatedTokensAfter: 5 }))).toBe(false)
  })
})
