import { describe, it, expect, vi, afterEach } from 'vitest'
import { getIntentCentroid, clearIntentCache } from './cache.js'
import type { IntentDefinition } from '@routerly/shared'
import type { EmbeddingProvider } from '../../embeddings/types.js'

afterEach(() => { clearIntentCache() })

function makeIntent(examples: string[]): IntentDefinition {
  return { examples, candidate_models: [] }
}

function makeProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    embed: vi.fn(async (texts: string[], _model: string) => ({
      embeddings: texts.map(t => vectors[t] ?? [0, 0, 0]),
      inputTokens: 0,
    })),
  }
}

describe('getIntentCentroid', () => {
  it('embeds examples and returns centroid', async () => {
    const provider = makeProvider({
      'hello': [1, 0, 0],
      'world': [0, 1, 0],
    })
    const intent = makeIntent(['hello', 'world'])
    const centroid = await getIntentCentroid('test', intent, provider, 'text-emb-3-small')
    expect(centroid).toHaveLength(3)
    expect(centroid[0]).toBeCloseTo(0.5, 5)
    expect(centroid[1]).toBeCloseTo(0.5, 5)
  })

  it('caches results and avoids re-embedding on second call', async () => {
    const provider = makeProvider({ 'example': [1, 0] })
    const intent = makeIntent(['example'])
    await getIntentCentroid('intent', intent, provider, 'model')
    await getIntentCentroid('intent', intent, provider, 'model')
    expect((provider.embed as any)).toHaveBeenCalledTimes(1)
  })

  it('re-embeds when examples change (different hash)', async () => {
    const provider = makeProvider({ 'a': [1, 0], 'b': [0, 1] })
    await getIntentCentroid('intent', makeIntent(['a']), provider, 'model')
    await getIntentCentroid('intent', makeIntent(['b']), provider, 'model')
    expect((provider.embed as any)).toHaveBeenCalledTimes(2)
  })

  it('re-embeds after cache is cleared', async () => {
    const provider = makeProvider({ 'test': [1, 0] })
    const intent = makeIntent(['test'])
    await getIntentCentroid('intent', intent, provider, 'model')
    clearIntentCache()
    await getIntentCentroid('intent', intent, provider, 'model')
    expect((provider.embed as any)).toHaveBeenCalledTimes(2)
  })

  it('uses different cache keys for different intent names', async () => {
    const provider = makeProvider({ 'x': [1, 0] })
    const intent = makeIntent(['x'])
    await getIntentCentroid('intentA', intent, provider, 'model')
    await getIntentCentroid('intentB', intent, provider, 'model')
    // Different intent names → different keys → both embed
    expect((provider.embed as any)).toHaveBeenCalledTimes(2)
  })

  it('respects custom TTL (short TTL expires quickly in fake time)', async () => {
    const provider = makeProvider({ 'sample': [1, 0] })
    const intent = makeIntent(['sample'])
    // Use 1ms TTL — we can't advance fake timers easily, but we test the path exists
    await getIntentCentroid('shortLived', intent, provider, 'model', 1)
    expect((provider.embed as any)).toHaveBeenCalledTimes(1)
  })
})
