import { describe, it, expect } from 'vitest'
import { capabilityPolicy } from './capability.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig } from '@routerly/shared'

function makeModel(id: string, caps?: Partial<NonNullable<ModelConfig['capabilities']>>): ModelConfig {
  return {
    id,
    name: id,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
    ...(caps !== undefined ? { capabilities: caps } : {}),
  }
}

function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    request: { model: 'auto', messages: [] },
    candidates: [],
    ...overrides,
  } as PolicyInput
}

describe('capabilityPolicy', () => {
  it('returns 1.0 for all models when no special features needed', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto', messages: [{ role: 'user', content: 'hello' }] },
      candidates: [
        { model: makeModel('gpt-4') },
        { model: makeModel('claude-3') },
      ],
    }))
    expect(result.routing).toHaveLength(2)
    expect(result.routing[0]!.point).toBe(1.0)
    expect(result.routing[1]!.point).toBe(1.0)
    expect(result.excludes).toBeUndefined()
  })

  it('penalises models with vision === false when request contains images', async () => {
    const result = await capabilityPolicy(makeInput({
      request: {
        model: 'auto',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://x' } }] }],
      } as any,
      candidates: [
        { model: makeModel('no-vision', { vision: false }) },
        { model: makeModel('has-vision', { vision: true }) },
        { model: makeModel('undeclared') },
      ],
    }))
    expect(result.routing.find(r => r.model === 'no-vision')!.point).toBe(0.0)
    expect(result.routing.find(r => r.model === 'has-vision')!.point).toBe(1.0)
    expect(result.routing.find(r => r.model === 'undeclared')!.point).toBe(1.0)
    expect(result.excludes).toContain('no-vision')
  })

  it('does not flag vision when messages have no image content parts', async () => {
    const result = await capabilityPolicy(makeInput({
      request: {
        model: 'auto',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any,
      candidates: [{ model: makeModel('m', { vision: false }) }],
    }))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('penalises models with functionCalling === false when tools present', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto', messages: [], tools: [{ type: 'function', function: { name: 'foo' } }] } as any,
      candidates: [
        { model: makeModel('no-fn', { functionCalling: false }) },
        { model: makeModel('has-fn', { functionCalling: true }) },
      ],
    }))
    expect(result.routing.find(r => r.model === 'no-fn')!.point).toBe(0.0)
    expect(result.routing.find(r => r.model === 'has-fn')!.point).toBe(1.0)
  })

  it('penalises models with functionCalling === false when functions (legacy) present', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto', messages: [], functions: [{ name: 'bar' }] } as any,
      candidates: [{ model: makeModel('no-fn', { functionCalling: false }) }],
    }))
    expect(result.routing[0]!.point).toBe(0.0)
  })

  it('penalises models with json === false when json mode requested', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto', messages: [], response_format: { type: 'json_object' } } as any,
      candidates: [
        { model: makeModel('no-json', { json: false }) },
        { model: makeModel('has-json', { json: true }) },
      ],
    }))
    expect(result.routing.find(r => r.model === 'no-json')!.point).toBe(0.0)
    expect(result.routing.find(r => r.model === 'has-json')!.point).toBe(1.0)
  })

  it('does not penalise json when response_format type is not json_object', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto', messages: [], response_format: { type: 'text' } } as any,
      candidates: [{ model: makeModel('m', { json: false }) }],
    }))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('handles multiple incompatibilities on the same model', async () => {
    const result = await capabilityPolicy(makeInput({
      request: {
        model: 'auto',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
        tools: [{ type: 'function', function: { name: 'f' } }],
        response_format: { type: 'json_object' },
      } as any,
      candidates: [{ model: makeModel('m', { vision: false, functionCalling: false, json: false }) }],
    }))
    expect(result.routing[0]!.point).toBe(0.0)
    expect(result.routing[0]!.incompatible).toHaveLength(3)
  })

  it('does not add excludes field when all models pass', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto', messages: [] },
      candidates: [{ model: makeModel('m') }],
    }))
    expect(result.excludes).toBeUndefined()
  })

  it('handles non-array message content gracefully', async () => {
    const result = await capabilityPolicy(makeInput({
      request: {
        model: 'auto',
        messages: [{ role: 'user', content: 'just text' }],
      },
      candidates: [{ model: makeModel('m', { vision: false }) }],
    }))
    expect(result.routing[0]!.point).toBe(1.0)
  })

  it('uses empty array when request.messages is undefined (line 20 ?? [] branch)', async () => {
    const result = await capabilityPolicy(makeInput({
      request: { model: 'auto' } as any,
      candidates: [{ model: makeModel('m') }],
    }))
    expect(result.routing[0]!.point).toBe(1.0)
  })
})
