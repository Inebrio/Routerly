import { describe, it, expect } from 'vitest'
import { getEmbeddingProvider } from './index.js'

describe('getEmbeddingProvider', () => {
  it('returns OpenAI provider for type=openai', () => {
    const provider = getEmbeddingProvider('openai', 'https://api.openai.com/v1', 'sk-test')
    expect(provider).toBeDefined()
    expect(typeof provider.embed).toBe('function')
  })

  it('returns Ollama provider for type=ollama', () => {
    const provider = getEmbeddingProvider('ollama', 'http://localhost:11434')
    expect(provider).toBeDefined()
    expect(typeof provider.embed).toBe('function')
  })

  it('throws for unknown provider type', () => {
    expect(() => getEmbeddingProvider('unknown' as any)).toThrow('Unknown embedding provider type')
  })

  it('creates OpenAI provider without optional params', () => {
    const provider = getEmbeddingProvider('openai')
    expect(provider).toBeDefined()
  })

  it('creates Ollama provider without optional params', () => {
    const provider = getEmbeddingProvider('ollama')
    expect(provider).toBeDefined()
  })
})
