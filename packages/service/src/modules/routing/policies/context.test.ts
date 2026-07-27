import { describe, it, expect } from 'vitest'
import { contextPolicy } from './context.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig } from '@routerly/shared'

function makeModel(id: string, contextWindow?: number): ModelConfig {
  return {
    id,
    name: id,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  }
}

function makeInput(messages: any[], candidates: PolicyInput['candidates']): PolicyInput {
  return { request: { model: 'auto', messages }, candidates } as PolicyInput
}

describe('contextPolicy', () => {
  it('returns 1.0 for model without contextWindow configured', async () => {
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: 'hello' }],
      [{ model: makeModel('unlimited') }],
    ))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.contextWindow).toBeNull()
  })

  it('returns 1.0 when request easily fits in contextWindow', async () => {
    // 80 chars → ~20 tokens, well within 1000
    const msg = 'x'.repeat(80)
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: msg }],
      [{ model: makeModel('m', 1000) }],
    ))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('hard blocks model when estimatedTokens >= contextWindow', async () => {
    // 4000 chars → ~1000 tokens → exactly at contextWindow of 1000
    const msg = 'x'.repeat(4000)
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: msg }],
      [{ model: makeModel('m', 1000) }],
    ))
    expect(result.routing[0]!.point).toBe(0.0)
    expect(result.excludes).toContain('m')
  })

  it('hard blocks when request clearly exceeds contextWindow', async () => {
    // 8000 chars → ~2000 tokens > contextWindow of 100
    const msg = 'x'.repeat(8000)
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: msg }],
      [{ model: makeModel('m', 100) }],
    ))
    expect(result.routing[0]!.point).toBe(0.0)
  })

  it('applies linear penalty in warning zone (80-100% usage)', async () => {
    // 90% usage: 3600 chars → ~900 tokens for contextWindow=1000 → 90%
    const msg = 'x'.repeat(3600)
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: msg }],
      [{ model: makeModel('m', 1000) }],
    ))
    const point = result.routing[0]!.point
    expect(point).toBeGreaterThan(0)
    expect(point).toBeLessThan(1)
  })

  it('does not add excludes field when all models pass', async () => {
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: 'hi' }],
      [{ model: makeModel('m', 10000) }],
    ))
    expect(result.excludes).toBeUndefined()
  })

  it('handles array content parts', async () => {
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
      [{ model: makeModel('m', 10000) }],
    ))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.estimatedTokens).toBeGreaterThan(0)
  })

  it('handles content parts without text field', async () => {
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: [{ type: 'image_url' }] }],
      [{ model: makeModel('m', 100) }],
    ))
    expect(result.routing[0]!.estimatedTokens).toBe(0)
  })

  it('handles empty messages array', async () => {
    const result = await contextPolicy(makeInput(
      [],
      [{ model: makeModel('m', 100) }],
    ))
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[0]!.estimatedTokens).toBe(0)
  })

  it('returns estimatedTokens in routing entry', async () => {
    const msg = 'a'.repeat(400) // 400 chars → 100 tokens
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: msg }],
      [{ model: makeModel('m', 10000) }],
    ))
    expect(result.routing[0]!.estimatedTokens).toBe(100)
  })

  it('handles request without messages property (messages ?? [] branch, line 25)', async () => {
    // Pass a request that has no messages field at all → hits the ?? [] fallback
    const result = await contextPolicy({
      request: { model: 'auto' } as any,
      candidates: [{ model: makeModel('m', 1000) }],
    } as PolicyInput)
    expect(result.routing[0]!.estimatedTokens).toBe(0)
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('handles message with null/undefined content (return sum branch, line 30)', async () => {
    // A message whose content is neither string nor array → hits the bare `return sum` branch
    const result = await contextPolicy(makeInput(
      [{ role: 'user', content: null as any }],
      [{ model: makeModel('m', 1000) }],
    ))
    expect(result.routing[0]!.estimatedTokens).toBe(0)
    expect(result.routing[0]!.point).toBe(1.0)
  })
})
