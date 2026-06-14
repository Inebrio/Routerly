import { describe, it, expect } from 'vitest'
import { cheapestPolicy } from './cheapest.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig } from '@routerly/shared'

function makeModel(id: string, inputPerMillion: number, outputPerMillion: number): ModelConfig {
  return {
    id,
    name: id,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion, outputPerMillion },
  }
}

function makeInput(candidates: PolicyInput['candidates']): PolicyInput {
  return { request: { model: 'auto', messages: [] }, candidates } as PolicyInput
}

describe('cheapestPolicy', () => {
  it('assigns 1.0 to the cheapest model', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('cheap', 1, 2) },
      { model: makeModel('expensive', 10, 20) },
    ]))
    expect(result.routing.find(r => r.model === 'cheap')!.point).toBe(1.0)
  })

  it('assigns proportional score to more expensive models', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('cheap', 2, 2) },   // avgCost = 2
      { model: makeModel('expensive', 4, 4) }, // avgCost = 4 → 2/4 = 0.5
    ]))
    const expensiveScore = result.routing.find(r => r.model === 'expensive')!.point
    expect(expensiveScore).toBeCloseTo(0.5, 5)
  })

  it('free model (cost=0) always gets 1.0', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('free', 0, 0) },
      { model: makeModel('paid', 2, 2) },
    ]))
    expect(result.routing.find(r => r.model === 'free')!.point).toBe(1.0)
  })

  it('paid models get at most 0.5 when a free model is present', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('free', 0, 0) },
      { model: makeModel('cheap-paid', 1, 1) },
      { model: makeModel('pricier', 2, 2) },
    ]))
    const cheapPaidScore = result.routing.find(r => r.model === 'cheap-paid')!.point
    const pricierScore = result.routing.find(r => r.model === 'pricier')!.point
    expect(cheapPaidScore).toBeLessThanOrEqual(0.5)
    expect(pricierScore).toBeLessThan(cheapPaidScore)
  })

  it('handles single candidate', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('solo', 5, 10) },
    ]))
    expect(result.routing).toHaveLength(1)
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('includes avgCostPerMillion in output', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('m', 4, 8) },
    ]))
    expect(result.routing[0]!.avgCostPerMillion).toBe(6)
  })

  it('all free models all get 1.0', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('a', 0, 0) },
      { model: makeModel('b', 0, 0) },
    ]))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[1]!.point).toBe(1.0)
  })

  it('10x more expensive model gets ~0.1 score', async () => {
    const result = await cheapestPolicy(makeInput([
      { model: makeModel('cheap', 1, 1) },
      { model: makeModel('pricey', 10, 10) },
    ]))
    const priceyScore = result.routing.find(r => r.model === 'pricey')!.point
    expect(priceyScore).toBeCloseTo(0.1, 5)
  })
})
