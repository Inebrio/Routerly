import { describe, it, expect } from 'vitest'
import { getProviderAdapter } from './index.js'
import type { ModelConfig } from '@routerly/shared'

import type { Provider } from '@routerly/shared'

function makeModel(provider: string): ModelConfig {
  return {
    id: `${provider}/model`, name: 'M', provider: provider as Provider,
    endpoint: 'https://api.example.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

describe('getProviderAdapter', () => {
  it('returns an adapter for openai', () => {
    const adapter = getProviderAdapter(makeModel('openai'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for anthropic', () => {
    const adapter = getProviderAdapter(makeModel('anthropic'))
    expect(adapter).toBeDefined()
  })

  it('returns an adapter for anthropic-oauth', () => {
    const adapter = getProviderAdapter(makeModel('anthropic-oauth'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for openai-oauth', () => {
    const adapter = getProviderAdapter(makeModel('openai-oauth'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for gemini', () => {
    const adapter = getProviderAdapter(makeModel('gemini'))
    expect(adapter).toBeDefined()
  })

  it('returns an adapter for ollama', () => {
    const adapter = getProviderAdapter(makeModel('ollama'))
    expect(adapter).toBeDefined()
  })

  it('returns an adapter for custom', () => {
    const adapter = getProviderAdapter(makeModel('custom'))
    expect(adapter).toBeDefined()
  })

  it('throws for unknown provider', () => {
    expect(() => getProviderAdapter(makeModel('unknown-provider'))).toThrow(
      'Unknown provider "unknown-provider"',
    )
  })

  it('all standard adapters have required methods', () => {
    for (const provider of ['openai', 'anthropic', 'gemini', 'ollama', 'custom']) {
      const adapter = getProviderAdapter(makeModel(provider))
      expect(typeof adapter.chatCompletion).toBe('function')
      expect(typeof adapter.streamCompletion).toBe('function')
    }
  })
})
