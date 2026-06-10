import { describe, it, expect } from 'vitest'
import { calculateCost } from './calculator.js'
import type { ModelConfig } from '@routerly/shared'

function model(overrides: Partial<ModelConfig['cost']> = {}): ModelConfig {
  return {
    id: 'test-model',
    name: 'Test',
    provider: 'openai',
    endpoint: 'http://localhost',
    cost: {
      inputPerMillion: 1.0,
      outputPerMillion: 2.0,
      ...overrides,
    },
  } as ModelConfig
}

describe('calculateCost', () => {
  it('basic input + output cost', () => {
    const cost = calculateCost(1_000_000, 1_000_000, model())
    expect(cost).toBeCloseTo(3.0, 9)
  })

  it('zero tokens → zero cost', () => {
    expect(calculateCost(0, 0, model())).toBe(0)
  })

  it('cached input uses cachePerMillion when set', () => {
    const m = model({ cachePerMillion: 0.1 })
    // 1M cached tokens at 0.1/M + 1M output at 2/M = 2.1
    const cost = calculateCost(1_000_000, 1_000_000, m, 1_000_000)
    expect(cost).toBeCloseTo(2.1, 9)
  })

  it('cached input falls back to inputPerMillion when cachePerMillion absent', () => {
    // 1M cached → inputPerMillion(1.0) + 1M output → 2.0 = 3.0
    const cost = calculateCost(1_000_000, 1_000_000, model(), 1_000_000)
    expect(cost).toBeCloseTo(3.0, 9)
  })

  it('cache write uses cacheWritePerMillion when set', () => {
    const m = model({ cacheWritePerMillion: 0.5 })
    // 1M write at 0.5 + 1M output at 2.0 = 2.5
    const cost = calculateCost(1_000_000, 1_000_000, m, 0, 1_000_000)
    expect(cost).toBeCloseTo(2.5, 9)
  })

  it('cache write falls back to inputPerMillion when cacheWritePerMillion absent', () => {
    // 1M write at 1.0 + 1M output at 2.0 = 3.0
    const cost = calculateCost(1_000_000, 1_000_000, model(), 0, 1_000_000)
    expect(cost).toBeCloseTo(3.0, 9)
  })

  it('cached + write tokens are subtracted from plain input', () => {
    // 2M inputTokens, 500k cached, 500k write → 1M plain at 1.0 = 1.0
    // + 500k cached at 1.0 = 0.5
    // + 500k write at 1.0  = 0.5
    // + 0 output            = 0
    const cost = calculateCost(2_000_000, 0, model(), 500_000, 500_000)
    expect(cost).toBeCloseTo(2.0, 9)
  })

  it('small token count rounds correctly', () => {
    // 1 input token at $1/M + 1 output at $2/M = 0.000003
    const cost = calculateCost(1, 1, model())
    expect(cost).toBeCloseTo(0.000003, 9)
  })
})
