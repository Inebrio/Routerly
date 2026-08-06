import { describe, it, expect, vi, afterEach } from 'vitest'
import { OllamaEmbeddingProvider } from './ollama.js'

afterEach(() => { vi.restoreAllMocks() })

describe('OllamaEmbeddingProvider', () => {
  it('calls the Ollama embed API and returns embeddings', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OllamaEmbeddingProvider('http://localhost:11434')
    const result = await provider.embed(['hello', 'world'], 'nomic-embed-text')

    expect(result.embeddings).toHaveLength(2)
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3])
    expect(result.inputTokens).toBe(0)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('strips trailing slash from endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[1, 0]] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OllamaEmbeddingProvider('http://localhost:11434/')
    await provider.embed(['test'], 'model')

    const calledUrl = mockFetch.mock.calls[0]![0]
    expect(calledUrl).toBe('http://localhost:11434/api/embed')
  })

  it('uses default endpoint when none provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[1, 0]] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OllamaEmbeddingProvider()
    await provider.embed(['text'], 'model')

    expect(mockFetch.mock.calls[0]![0]).toBe('http://localhost:11434/api/embed')
  })

  it('throws when API responds with non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }))

    const provider = new OllamaEmbeddingProvider()
    await expect(provider.embed(['hello'], 'model')).rejects.toThrow('500')
  })
})
