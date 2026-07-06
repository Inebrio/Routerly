import { describe, it, expect } from 'vitest'
import { modelPreferencePolicy } from './model-preference.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig } from '@routerly/shared'

function makeModel(id: string): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

function makeInput(model: string, candidateIds: string[], config?: any): PolicyInput {
  return {
    request: { model, messages: [] },
    candidates: candidateIds.map(id => ({ model: makeModel(id) })),
    config,
  } as PolicyInput
}

describe('modelPreferencePolicy', () => {
  it('abstains when model is routerly/ada (all scores equal)', async () => {
    const result = await modelPreferencePolicy(makeInput('routerly/ada', ['gpt-4o', 'claude-3']))
    expect(result.routing.every(r => r.point === 0.5)).toBe(true)
  })

  it('abstains when model is empty string', async () => {
    const result = await modelPreferencePolicy(makeInput('', ['gpt-4o', 'claude-3']))
    expect(result.routing.every(r => r.point === 0.5)).toBe(true)
  })

  it('gives bonus to requested model, 0 to others', async () => {
    const result = await modelPreferencePolicy(makeInput('gpt-4o', ['gpt-4o', 'claude-3', 'ollama']))
    const gpt = result.routing.find(r => r.model === 'gpt-4o')!
    const claude = result.routing.find(r => r.model === 'claude-3')!
    const ollama = result.routing.find(r => r.model === 'ollama')!
    expect(gpt.point).toBe(1.0)
    expect(claude.point).toBe(0.0)
    expect(ollama.point).toBe(0.0)
  })

  it('respects custom bonus config', async () => {
    const result = await modelPreferencePolicy(makeInput('gpt-4o', ['gpt-4o', 'claude-3'], { bonus: 0.8 }))
    expect(result.routing.find(r => r.model === 'gpt-4o')!.point).toBe(0.8)
    expect(result.routing.find(r => r.model === 'claude-3')!.point).toBe(0.0)
  })

  it('marks requested model with requested:true flag', async () => {
    const result = await modelPreferencePolicy(makeInput('gpt-4o', ['gpt-4o', 'claude-3']))
    expect(result.routing.find(r => r.model === 'gpt-4o')!.requested).toBe(true)
    expect(result.routing.find(r => r.model === 'claude-3')!.requested).toBe(false)
  })

  it('scores all 0.0 for non-preferred when requested model is not in candidates', async () => {
    const result = await modelPreferencePolicy(makeInput('gpt-5', ['gpt-4o', 'claude-3']))
    expect(result.routing.every(r => r.point === 0.0)).toBe(true)
  })

  it('does not add excludes (non-preferred models remain candidates)', async () => {
    const result = await modelPreferencePolicy(makeInput('gpt-4o', ['gpt-4o', 'claude-3']))
    expect(result.excludes).toBeUndefined()
  })
})
