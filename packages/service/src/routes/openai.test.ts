import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

vi.mock('../routing/router.js', () => ({ routeRequest: vi.fn() }))
vi.mock('../routing/routingMemoryStore.js', () => ({ addRoutingDecision: vi.fn() }))
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../routing/traceStore.js', () => ({ setTrace: vi.fn(), appendTrace: vi.fn() }))
vi.mock('../llm/executor.js', () => ({
  llmChat: vi.fn(),
  llmStream: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {
    override name = 'BudgetExceededError'
    modelId: string
    constructor(modelId: string) { super('budget_exceeded'); this.modelId = modelId }
  },
}))
vi.mock('../embeddings/index.js', () => ({ getEmbeddingProvider: vi.fn() }))
vi.mock('../cache/semanticResponseCache.js', () => ({ lookupCache: vi.fn(() => null), storeCache: vi.fn() }))

import { openaiRoutes } from './openai.js'
import { routeRequest } from '../routing/router.js'
import { readConfig } from '../config/loader.js'
import { llmChat, llmStream } from '../llm/executor.js'
import { getEmbeddingProvider } from '../embeddings/index.js'
import { lookupCache, storeCache } from '../cache/semanticResponseCache.js'

const mockRouteRequest = vi.mocked(routeRequest)
const mockReadConfig = vi.mocked(readConfig)
const mockLlmChat = vi.mocked(llmChat)
const mockLlmStream = vi.mocked(llmStream)
const mockGetEmbeddingProvider = vi.mocked(getEmbeddingProvider)
const mockLookupCache = vi.mocked(lookupCache)
const mockStoreCache = vi.mocked(storeCache)

afterEach(() => vi.clearAllMocks())

const testModel: any = {
  id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai',
  endpoint: 'https://api.openai.com/v1', apiKey: 'sk-test',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
}

const testProject: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [],
  models: [{ modelId: 'openai/gpt-4o' }],
}

function makeCompletion() {
  return {
    id: 'chatcmpl-1', object: 'chat.completion', created: 1700000000,
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

async function buildApp(project = testProject) {
  const app = Fastify({ logger: false })
  app.decorateRequest('project', null as any)
  app.decorateRequest('token', null as any)
  app.addHook('preHandler', async (req: any) => {
    req.project = project
    req.token = undefined
  })
  await app.register(openaiRoutes)
  await app.ready()
  return app
}

// ─── POST /v1/chat/completions (non-streaming) ────────────────────────────────

describe('POST /v1/chat/completions — non-streaming', () => {
  it('routes and returns completion response', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('Hello!')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
  })

  it('returns 500 when routing fails', async () => {
    mockRouteRequest.mockRejectedValue(new Error('no models'))
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error.type).toBe('server_error')
  })

  it('returns 503 when all candidates fail', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockRejectedValue(new Error('provider error'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(503)
  })

  it('skips model not found in allModels', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'nonexistent', weight: 1 }, { model: 'openai/gpt-4o', weight: 0.5 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })

  it('skips BudgetExceededError and continues to next candidate', async () => {
    const { BudgetExceededError } = await import('../llm/executor.js')
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }, { model: 'openai/gpt-4o', weight: 0.5 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat
      .mockRejectedValueOnce(new BudgetExceededError('openai/gpt-4o'))
      .mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
  })

  it('invokes emit callback passed to routeRequest (covers non-streaming emit function)', async () => {
    mockRouteRequest.mockImplementation(async (_body: any, _project: any, _log: any, emit: any) => {
      emit?.({ panel: 'router-request', message: 'test:event', details: {} })
      return { models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] }
    })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('saves routing decision when memory policy is enabled', async () => {
    const projectWithMemory: ProjectConfig = {
      ...testProject,
      policies: [{ type: 'llm', enabled: true, config: { memory: true } } as any],
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithMemory)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-routerly-conversation-id': 'conv-123' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })
})

// ─── POST /v1/chat/completions (streaming) ────────────────────────────────────

describe('POST /v1/chat/completions — streaming', () => {
  it('streams SSE chunks to client', async () => {
    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 1700000000, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
      { id: 'c2', object: 'chat.completion.chunk', created: 1700000000, model: 'gpt-4o', choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] },
    ]

    async function* chunkGen() { for (const c of chunks) yield c }

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: chunkGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
    expect(res.body).toContain('Hello')
  })

  it('writes error chunk and [DONE] when routing fails during stream', async () => {
    mockRouteRequest.mockRejectedValue(new Error('routing failed'))
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
    expect(res.body).toContain('Routing failed')
  })

  it('writes error chunk and [DONE] when all streaming candidates fail', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockRejectedValue(new Error('stream failed'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
  })

  it('sets CORS headers when origin is present', async () => {
    async function* emptyGen() {}
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: emptyGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3001' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001')
  })

  it('handles mid-stream error gracefully', async () => {
    async function* failingGen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }
      throw new Error('mid-stream failure')
    }

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: failingGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
  })

  it('saves routing decision when memory policy is enabled and conversationId is present (streaming)', async () => {
    const projectWithMemory: any = {
      ...testProject,
      policies: [{ type: 'llm', enabled: true, config: { memory: true } }],
    }
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithMemory)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-routerly-conversation-id': 'stream-conv-1' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
  })

  it('skips BudgetExceededError candidate during streaming', async () => {
    const { BudgetExceededError } = await import('../llm/executor.js')
    async function* goodGen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }

    const allModels = [testModel, { ...testModel, id: 'openai/gpt-3.5' }]
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }, { model: 'openai/gpt-3.5', weight: 0.5 }], trace: [] })
    mockReadConfig.mockResolvedValue(allModels)
    mockLlmStream
      .mockRejectedValueOnce(new BudgetExceededError('openai/gpt-4o'))
      .mockResolvedValue({ ttftMs: 50, chunks: goodGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
    expect(mockLlmStream).toHaveBeenCalledTimes(2)
  })
})

// ─── POST /v1/responses ───────────────────────────────────────────────────────

describe('POST /v1/responses', () => {
  it('normalizes input → messages and sets stream:true', async () => {
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
    const callBody = (mockLlmStream.mock.calls[0]![0] as any)
    expect(callBody.stream).toBe(true)
    expect(callBody.messages).toBeDefined()
    expect(callBody.input).toBeUndefined()
  })

  it('normalizes max_completion_tokens → max_output_tokens', async () => {
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp()
    await app.inject({
      method: 'POST', url: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o', stream: false,
        messages: [{ role: 'user', content: 'Hi' }],
        max_completion_tokens: 512,
      }),
    })
    await app.close()

    const callBody = (mockLlmStream.mock.calls[0]![0] as any)
    expect(callBody.max_output_tokens).toBe(512)
  })
})

// ─── GET /v1/models ───────────────────────────────────────────────────────────

describe('GET /v1/models', () => {
  it('returns project model list with ada placeholder', async () => {
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/models' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.object).toBe('list')
    expect(body.data.some((m: any) => m.id === 'routerly/ada')).toBe(true)
    expect(body.data.some((m: any) => m.id === 'openai/gpt-4o')).toBe(true)
  })
})

describe('GET /v1/models/:model', () => {
  it('returns a specific model', async () => {
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/models/openai%2Fgpt-4o' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe('openai/gpt-4o')
    expect(body.object).toBe('model')
  })

  it('returns 404 for model not in project', async () => {
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/models/not-in-project' })
    await app.close()

    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when model is in project but not in allModels', async () => {
    const projectWithMissing: ProjectConfig = { ...testProject, models: [{ modelId: 'missing-model' }] }
    mockReadConfig.mockResolvedValue([]) // no models in allModels

    const app = await buildApp(projectWithMissing)
    const res = await app.inject({ method: 'GET', url: '/v1/models/missing-model' })
    await app.close()

    expect(res.statusCode).toBe(404)
  })
})

// ─── Semantic cache (via /v1/chat/completions) ───────────────────────────────

const projectWithCache: any = {
  id: 'proj-cache', name: 'CacheTest', tokens: [], members: [],
  models: [{ modelId: 'openai/gpt-4o' }],
  policies: [{
    type: 'llm', enabled: true,
    config: {
      cache: {
        enabled: true,
        embedding_model: 'openai/text-embedding-ada-002',
        embedding_provider: 'openai',
        similarity_threshold: 0.85,
        ttl_seconds: 3600,
      },
    },
  }],
}

describe('POST /v1/chat/completions — semantic cache', () => {
  it('non-streaming: cache hit skips routing and returns response', async () => {
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue({ modelId: 'openai/gpt-4o', similarity: 0.95 } as any)
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(mockRouteRequest).not.toHaveBeenCalled()
  })

  it('non-streaming: cache miss stores result after success', async () => {
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(mockStoreCache).toHaveBeenCalled()
  })

  it('streaming: cache hit skips routing', async () => {
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'cached' }, finish_reason: 'stop' }] }
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue({ modelId: 'openai/gpt-4o', similarity: 0.95 } as any)
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.body).toContain('[DONE]')
    expect(mockRouteRequest).not.toHaveBeenCalled()
  })

  it('streaming: cache miss stores result after success', async () => {
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithCache)
    await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(mockStoreCache).toHaveBeenCalled()
  })

  it('embedding failure proceeds without cache (graceful degradation)', async () => {
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockRejectedValue(new Error('embed failed')) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('outer cache catch: lookupCache throws → falls back gracefully', async () => {
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockImplementation(() => { throw new Error('cache store error') })
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200) // graceful fallback despite cache error
  })

  it('extend_on_hit passes extendMs to lookupCache', async () => {
    const projectWithExtend: any = {
      ...projectWithCache,
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: {
            enabled: true,
            embedding_model: 'openai/text-embedding-ada-002',
            embedding_provider: 'openai',
            similarity_threshold: 0.85,
            ttl_seconds: 3600,
            extend_on_hit: true,
          },
        },
      }],
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue({ modelId: 'openai/gpt-4o', similarity: 0.92 } as any)
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithExtend)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(mockLookupCache).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.any(Number), expect.any(Number))
  })

  it('uses model upstreamModelId when available from modelDef', async () => {
    const modelWithUpstream = { ...testModel, id: 'openai/text-embedding-ada-002', upstreamModelId: 'text-embedding-ada-002' }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel, modelWithUpstream])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('falls back to next embedding model on failure', async () => {
    const projectWithFallback: any = {
      ...projectWithCache,
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: {
            enabled: true,
            embedding_model: 'failing-embed',
            embedding_fallback_models: ['openai/text-embedding-ada-002'],
            embedding_provider: 'openai',
            similarity_threshold: 0.85,
            ttl_seconds: 3600,
          },
        },
      }],
    }
    mockGetEmbeddingProvider
      .mockReturnValueOnce({ embed: vi.fn().mockRejectedValue(new Error('primary failed')) } as any)
      .mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithFallback)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })
})

// ─── getCacheEmbeddingText (via array messages path) ─────────────────────────

describe('getCacheEmbeddingText edge cases (via /v1/chat/completions)', () => {
  function setupCacheMocks() {
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)
  }

  it('handles array content parts in messages (covers lines 31-40)', async () => {
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello from parts' }] }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(mockGetEmbeddingProvider).toHaveBeenCalled()
  })

  it('handles messages with no user content (fallback to messages.map)', async () => {
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: 'be helpful' }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('handles array content parts where all parts have no text → falls back to messages.map (covers lines 42-51)', async () => {
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:...' } }] }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('handles non-string message content in fallback map (content is object) (covers lines 46-48)', async () => {
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'assistant', content: { type: 'complex' } }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

// ─── resolveEmbeddingUpstreamModelId / getCacheEmbeddingText — deeper branch coverage ──

describe('getCacheEmbeddingText — non-object message in .find() (line 22)', () => {
  function setupCacheMocks() {
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)
  }

  it('handles null/primitive entries in messages array (covers line 22 !message branch)', async () => {
    // null and primitive entries in the messages array → getCacheEmbeddingText `.find()` returns false for them
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        // Mix null/primitive values before the real user message to exercise line 22 `!message` branch
        messages: [null, 'not-an-object', { role: 'user', content: 'Hello' }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('handles null part in array content (covers line 34 !part branch)', async () => {
    // Array content where one element is null → line 34 `!part` branch returns null
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [null, { type: 'text', text: 'real text' }] }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('handles null message entry in fallback messages.map (covers line 44)', async () => {
    // No user message at all, so fallback map runs; include a null entry to hit line 44
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        // All system messages (no 'user' role) → fallback map; null entry hits line 44
        messages: [null, { role: 'system', content: 'be helpful' }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('handles message with undefined role in fallback map (covers line 49 ?? "unknown")', async () => {
    // No 'user' message so fallback map runs; message has no role → `role ?? 'unknown'`
    setupCacheMocks()
    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ content: 'some content without role' }],
      }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /v1/chat/completions — missing messages field (line 104)', () => {
  it('non-streaming: works when messages field is absent (body.messages ?? [])', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // Deliberately omit 'messages' to exercise body.messages ?? []
      payload: JSON.stringify({ model: 'gpt-4o' }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /v1/chat/completions — cache config defaults (lines 137-138)', () => {
  it('non-streaming: uses default similarity_threshold and ttl_seconds when absent', async () => {
    const projectWithCacheNoDefaults: any = {
      id: 'proj-nodef', name: 'NoDefaults', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: {
            enabled: true,
            embedding_model: 'openai/text-embedding-ada-002',
            embedding_provider: 'openai',
            // intentionally omit similarity_threshold and ttl_seconds → hit ?? defaults on lines 137-138
          },
        },
      }],
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCacheNoDefaults)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    // default threshold 0.85 used
    expect(mockLookupCache).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 0.85, undefined)
  })

  it('cache policy: messages field absent with cache enabled (line 140 body.messages ?? [])', async () => {
    const projectWithCachePolicy: any = {
      id: 'proj-nomsg', name: 'NoMsg', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: { enabled: true, embedding_model: 'openai/text-embedding-ada-002', embedding_provider: 'openai' },
        },
      }],
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCachePolicy)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // No messages field → body.messages ?? [] on line 140
      payload: JSON.stringify({ model: 'gpt-4o' }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /v1/chat/completions — ollama embedding provider (line 154)', () => {
  it('uses ollama provider type when model definition has provider=ollama', async () => {
    const ollamaEmbedModel = { ...testModel, id: 'openai/text-embedding-ada-002', provider: 'ollama' }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel, ollamaEmbedModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    // getEmbeddingProvider should have been called with 'ollama'
    expect(mockGetEmbeddingProvider).toHaveBeenCalledWith('ollama', expect.anything(), expect.anything())
  })

  it('uses embedding_provider ?? "openai" default when modelDef has no provider field', async () => {
    const projectWithNullProvider: any = {
      ...projectWithCache,
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: {
            enabled: true,
            embedding_model: 'openai/text-embedding-ada-002',
            // no embedding_provider → cacheConfig.embedding_provider ?? 'openai'
          },
        },
      }],
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithNullProvider)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(mockGetEmbeddingProvider).toHaveBeenCalledWith('openai', undefined, undefined)
  })
})

describe('POST /v1/chat/completions — embeddings[0] ?? null (line 174)', () => {
  it('handles empty embeddings array gracefully (embeddings[0] is undefined)', async () => {
    // embed returns empty embeddings array → embeddings[0] ?? null → cacheVector stays null
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    // Should still succeed (no cacheVector → no lookupCache call)
    expect(res.statusCode).toBe(200)
    expect(mockLookupCache).not.toHaveBeenCalled()
  })
})

describe('POST /v1/chat/completions — non-Error routing failure (lines 241, 243, 332)', () => {
  it('streaming: handles non-Error thrown during routing (covers line 241 String(err))', async () => {
    // Throw a string (non-Error) to exercise `String(err)` branch on line 241
    mockRouteRequest.mockRejectedValue('plain string error')
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.body).toContain('[DONE]')
    expect(res.body).toContain('Routing failed')
  })

  it('streaming: body.model absent → uses empty string (covers line 243 body.model ?? "")', async () => {
    mockRouteRequest.mockRejectedValue(new Error('routing error'))
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // Omit model field
      payload: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.body).toContain('[DONE]')
  })

  it('non-streaming: handles non-Error thrown during routing (covers line 332 String(err))', async () => {
    mockRouteRequest.mockRejectedValue('plain string failure')
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error.message).toContain('plain string failure')
  })
})

describe('POST /v1/chat/completions — streaming all-candidates-exhausted (line 311)', () => {
  it('streaming: model absent in body when all candidates fail (body.model ?? "")', async () => {
    // Route returns a candidate, model found, but stream throws → all candidates exhausted
    // body has no model field to exercise line 311 `body.model ?? ''`
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockRejectedValue(new Error('stream failed'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // Omit model field
      payload: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.body).toContain('[DONE]')
  })
})

describe('POST /v1/chat/completions — mid-stream non-Error (line 300)', () => {
  it('handles non-Error thrown mid-stream (covers line 300 String(err))', async () => {
    async function* failingGenNonError() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'non-error string thrown mid-stream'
    }

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: failingGenNonError() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.body).toContain('[DONE]')
  })
})

describe('POST /v1/chat/completions — cacheHit with null cacheSimilarityScore (lines 270, 357)', () => {
  it('streaming: cache hit with null similarity score (cacheSimilarityScore !== null is false)', async () => {
    // lookupCache returns a hit with similarity: null → cacheSimilarityScore assigned null
    // This exercises line 270: `cacheSimilarityScore !== null` → false branch (no cacheSimilarity spread)
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    // similarity: null → cacheSimilarityScore = null → `cacheSimilarityScore !== null` is false
    mockLookupCache.mockReturnValue({ modelId: 'openai/gpt-4o', similarity: null } as any)
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(res.body).toContain('[DONE]')
    expect(mockRouteRequest).not.toHaveBeenCalled()
  })

  it('non-streaming: cache hit with null similarity score (cacheSimilarityScore !== null is false, line 357)', async () => {
    // similarity: null → `cacheSimilarityScore !== null` is false → no cacheSimilarity in ctx spread
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue({ modelId: 'openai/gpt-4o', similarity: null } as any)
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(mockRouteRequest).not.toHaveBeenCalled()
  })
})

describe('POST /v1/chat/completions — streaming candidate not in allModels (line 259)', () => {
  it('streaming: cachedModelId not found in allModels falls through to all-exhausted (line 259)', async () => {
    // Cache hit points to a model not in allModels list → `if (!model) continue` on line 259
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue({ modelId: 'nonexistent-cached-model', similarity: 0.99 } as any)
    mockReadConfig.mockResolvedValue([testModel]) // testModel id is openai/gpt-4o, not nonexistent-cached-model

    const app = await buildApp(projectWithCache)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    // All candidates exhausted since only candidate not found in allModels
    expect(res.body).toContain('[DONE]')
    expect(mockLlmStream).not.toHaveBeenCalled()
  })
})

describe('POST /v1/chat/completions — streaming cache miss stores result (line 296)', () => {
  it('streaming: cache miss with cachePolicy and cacheVector → stores in cache after success', async () => {
    // This is actually already tested but let's ensure the ttl_seconds ?? 3600 default is also hit
    const projectWithCacheNoTtl: any = {
      id: 'proj-nottl', name: 'NoTTL', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: {
            enabled: true,
            embedding_model: 'openai/text-embedding-ada-002',
            embedding_provider: 'openai',
            // no ttl_seconds → hits ?? 3600 default on line 296
          },
        },
      }],
    }
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithCacheNoTtl)
    await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(mockStoreCache).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'openai/gpt-4o', 3600 * 1000)
  })
})

describe('POST /v1/chat/completions — non-streaming cache miss ttl default (line 375)', () => {
  it('non-streaming: cache miss with no ttl_seconds hits default 3600 on storeCache call', async () => {
    const projectWithCacheNoTtl: any = {
      id: 'proj-nottl2', name: 'NoTTL2', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      policies: [{
        type: 'llm', enabled: true,
        config: {
          cache: {
            enabled: true,
            embedding_model: 'openai/text-embedding-ada-002',
            embedding_provider: 'openai',
            // no ttl_seconds → hits ?? 3600 default on line 375
          },
        },
      }],
    }
    mockGetEmbeddingProvider.mockReturnValue({ embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) } as any)
    mockLookupCache.mockReturnValue(null)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(projectWithCacheNoTtl)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(mockStoreCache).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'openai/gpt-4o', 3600 * 1000)
  })
})

// ─── Branch coverage — line 289 (if delta) FALSE branch ──────────────────────

describe('POST /v1/chat/completions — line 289 if(delta) FALSE branch', () => {
  it('stream with usage-only chunk (no delta.content) does not append to fullContent', async () => {
    async function* chunkGen() {
      // First chunk has content
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }
      // Usage chunk has empty choices — delta is undefined → if(delta) is FALSE
      yield { id: 'u1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [] }
    }

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 0, chunks: chunkGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.body).toContain('[DONE]')
    expect(res.body).toContain('ok')
  })
})
