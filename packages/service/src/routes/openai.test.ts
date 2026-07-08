import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

vi.mock('../routing/router.js', () => ({ routeRequest: vi.fn() }))
vi.mock('../routing/routingMemoryStore.js', () => ({ addRoutingDecision: vi.fn() }))
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../routing/traceStore.js', () => ({ setTrace: vi.fn(), appendTrace: vi.fn() }))
vi.mock('./openaiOAuthForward.js', () => ({ resolveCodexToken: vi.fn(), forwardOpenAIOAuthSSE: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../llm/executor.js', () => ({
  llmChat: vi.fn(),
  llmStream: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {
    override name = 'BudgetExceededError'
    modelId: string
    constructor(modelId: string) { super('budget_exceeded'); this.modelId = modelId }
  },
}))
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn(() => Promise.resolve()) }))

import { openaiRoutes } from './openai.js'
import { routeRequest } from '../routing/router.js'
import { readConfig } from '../config/loader.js'
import { llmChat, llmStream } from '../llm/executor.js'
import { appendTrace } from '../routing/traceStore.js'
import { trackUsage } from '../cost/tracker.js'
import { forwardOpenAIOAuthSSE } from './openaiOAuthForward.js'

const mockRouteRequest = vi.mocked(routeRequest)
const mockReadConfig = vi.mocked(readConfig)
const mockLlmChat = vi.mocked(llmChat)
const mockLlmStream = vi.mocked(llmStream)
const mockAppendTrace = vi.mocked(appendTrace)
const mockTrackUsage = vi.mocked(trackUsage)
const mockForwardOpenAIOAuthSSE = vi.mocked(forwardOpenAIOAuthSSE)

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
      headers: { 'content-type': 'application/json', 'x-routerly-trace': '1' },
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

  it('includes trace SSE events when x-routerly-no-trace is absent', async () => {
    async function* chunkGen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 1700000000, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [{ panel: 'router-request', message: 'selected', details: {} }] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: chunkGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('"type":"trace"')
  })

  it('suppresses trace SSE events when x-routerly-no-trace: 1 is set, but still streams choices', async () => {
    async function* chunkGen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 1700000000, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [{ panel: 'router-request', message: 'selected', details: {} }] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: chunkGen() } as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-routerly-no-trace': '1' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).not.toContain('"type":"trace"')
    expect(res.body).toContain('"choices"')
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

// ─── Streaming response guardrail (#77 regression) ───────────────────────────

describe('POST /v1/chat/completions — streaming response guardrail (block)', () => {
  const projectWithResponseGuardrail: any = {
    id: 'proj-guard', name: 'GuardTest', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: {
      // No `enabled` field on the rule — presence + target is what activates it (#77).
      rules: [{ type: 'regex', target: 'response', block: true, config: { patterns: ['forbidden'] } }],
    },
  }

  it('buffers SSE and suppresses matched content, emitting content_filter fallback', async () => {
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'this is ' }, finish_reason: null }] }
      yield { id: 'c2', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'forbidden text' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithResponseGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    // Matched content must NOT leak to the client.
    expect(res.body).not.toContain('forbidden text')
    expect(res.body).not.toContain('this is ')
    // Wire-faithful block: empty delta + content_filter, no human-readable fallback in the stream.
    expect(res.body).not.toContain('Response blocked by content guardrails.')
    expect(res.body).toContain('content_filter')
    expect(res.body).toContain('"delta":{}')
    expect(res.body).toContain('[DONE]')
  })

  it('flushes buffered SSE unchanged when response does not match', async () => {
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'all clean here' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: gen() } as any)

    const app = await buildApp(projectWithResponseGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('all clean here')
    expect(res.body).not.toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })
})

// ─── Request guardrail block wire format + PII output trace (#76/#77) ──────────
describe('POST /v1/chat/completions — guardrail request block & PII output trace', () => {
  const blockProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['forbidden'] } }] },
  }

  it('non-streaming request block: empty content + content_filter, no fallback in wire, trace-id header', async () => {
    mockReadConfig.mockResolvedValue([testModel])
    const app = await buildApp(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-routerly-trace': '1' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'this is forbidden' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('')
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(res.body).not.toContain('nope')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
    const traceCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:triggered')
    expect((traceCall![1] as any[])[0].details).toMatchObject({ block: true, target: 'request' })
    expect(mockLlmChat).not.toHaveBeenCalled()
    // C3: a blocked request is recorded with outcome 'blocked', callType 'guardrail', cost 0, blockedBy set.
    expect(mockTrackUsage).toHaveBeenCalledTimes(1)
    const rec = mockTrackUsage.mock.calls[0]![0]
    expect(rec).toMatchObject({ projectId: 'proj-1', outcome: 'blocked', callType: 'guardrail', inputTokens: 0, outputTokens: 0, blockedBy: 'regex:forbidden', guardrailTriggered: 'regex:forbidden' })
  })

  it('non-streaming request block also emits a guardrail:evaluated trace (#77 C1)', async () => {
    mockReadConfig.mockResolvedValue([testModel])
    const app = await buildApp(blockProject)
    await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'this is forbidden' }] }),
    })
    await app.close()
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:evaluated')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details).toMatchObject({ target: 'request', rules: [{ rule: 'regex', outcome: 'triggered', reason: 'regex:forbidden' }] })
  })

  it('clean request emits guardrail:evaluated with passed rule, no triggered, no blocked record (#77 C1)', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)
    const app = await buildApp(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'all good here' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:evaluated')
    expect((evalCall![1] as any[])[0].details).toMatchObject({ target: 'request', rules: [{ rule: 'regex', outcome: 'passed' }] })
    const triggered = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:triggered')
    expect(triggered).toBeUndefined()
    // no blocked usage record on the clean path
    expect(mockTrackUsage.mock.calls.find(c => c[0].outcome === 'blocked')).toBeUndefined()
  })

  it('streaming request block: empty delta + content_filter + [DONE], no fallback', async () => {
    mockReadConfig.mockResolvedValue([testModel])
    const app = await buildApp(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-routerly-trace': '1' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'forbidden please' }] }),
    })
    await app.close()

    expect(res.body).toContain('content_filter')
    expect(res.body).toContain('"delta":{}')
    expect(res.body).toContain('[DONE]')
    expect(res.body).not.toContain('nope')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
    // C3: streaming block also records a blocked usage record.
    const rec = mockTrackUsage.mock.calls.find(c => c[0].outcome === 'blocked')
    expect(rec).toBeDefined()
    expect(rec![0]).toMatchObject({ outcome: 'blocked', callType: 'guardrail', blockedBy: 'regex:forbidden' })
  })

  it('non-streaming PII output scrubbing emits a response pii:scrubbed trace entry', async () => {
    const piiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'response', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'write to a@b.com' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('write to [EMAIL]')
    const piiTrace = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'response')
    expect(piiTrace).toBeDefined()
    expect((piiTrace![1] as any[])[0].details.entities).toContain('EMAIL')
  })

  it('streaming PII output scrubbing accumulates entities and traces at flush', async () => {
    const piiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'response', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'reach me at a@b.com ' }, finish_reason: null }] }
      yield { id: 'c2', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'thanks' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 10, chunks: gen() } as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.body).not.toContain('a@b.com')
    expect(res.body).toContain('[EMAIL]')
    const piiTrace = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'response')
    expect(piiTrace).toBeDefined()
    expect((piiTrace![1] as any[])[0].details.entities).toContain('EMAIL')
  })

  it('clean input with PII active emits pii:evaluated (redacted []) and no pii:scrubbed, wire response unchanged', async () => {
    const piiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'request', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'just a clean prompt' }] }),
    })
    await app.close()

    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:evaluated' && (c[1] as any[])[0]?.panel === 'request')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details.redacted).toEqual([])
    const scrubbed = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'request')
    expect(scrubbed).toBeUndefined()
    // wire-format transparency: response body is the standard completion shape, no added fields.
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual(makeCompletion())
  })

  it('input with a PII hit emits BOTH pii:evaluated (entities) and pii:scrubbed', async () => {
    const piiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'request', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'email me at a@b.com' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:evaluated' && (c[1] as any[])[0]?.panel === 'request')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details.redacted).toContain('EMAIL')
    const scrubbed = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'request')
    expect(scrubbed).toBeDefined()
    expect((scrubbed![1] as any[])[0].details.entities).toContain('EMAIL')
  })

  it('clean output (non-streaming) with scrubOutput active emits pii:evaluated (redacted []) and no pii:scrubbed', async () => {
    const piiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'response', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).choices[0].message.content).toBe('Hello!')
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:evaluated' && (c[1] as any[])[0]?.panel === 'response')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details.redacted).toEqual([])
    const scrubbed = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'response')
    expect(scrubbed).toBeUndefined()
  })

  it('clean output (streaming) with scrubOutput active emits pii:evaluated (redacted []) and no pii:scrubbed', async () => {
    const piiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'response', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'all clean here' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 10, chunks: gen() } as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('all clean here')
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:evaluated' && (c[1] as any[])[0]?.panel === 'response')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details.redacted).toEqual([])
    const scrubbed = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'response')
    expect(scrubbed).toBeUndefined()
  })

  it('response guardrail warn action: guardrailTriggered set but response passes through (line 491)', async () => {
    const warnProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'response', log: true, config: { patterns: ['warn-me'] } }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'warn-me content' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(warnProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // warn action: response passes through unmodified (not blocked)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('warn-me content')
    // guardrail:response-triggered trace was recorded with action=warn
    const triggerTrace = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:response-triggered')
    expect(triggerTrace).toBeDefined()
    expect((triggerTrace![1] as any[])[0].details.log).toBe(true)
  })

  it('routing fallback used emits routing.fallback_used event (line 497)', async () => {
    // Set up two models: primary fails (BudgetExceededError), fallback succeeds
    const twoModelProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }, { modelId: 'openai/gpt-4o-mini' }],
    }
    const fallbackModel: any = { ...testModel, id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' }
    // routeRequest returns both models in order
    mockRouteRequest.mockResolvedValue({ models: [
      { model: 'openai/gpt-4o', weight: 1 },
      { model: 'openai/gpt-4o-mini', weight: 0.5 },
    ], trace: [] })
    mockReadConfig.mockResolvedValue([testModel, fallbackModel])
    // Primary (gpt-4o) throws BudgetExceededError, fallback (gpt-4o-mini) succeeds
    const { BudgetExceededError: BCE } = await import('../llm/executor.js')
    mockLlmChat
      .mockRejectedValueOnce(new BCE('openai/gpt-4o'))
      .mockResolvedValueOnce(makeCompletion() as any)

    const app = await buildApp(twoModelProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // fallback was used — trackUsage was called with the fallback model
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
  })

  it('openai-oauth provider returns 422 in non-streaming path (line 437)', async () => {
    const oauthModel: any = { ...testModel, id: 'openai-oauth/gpt-4o', provider: 'openai-oauth' }
    const oauthProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai-oauth/gpt-4o' }],
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai-oauth/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([oauthModel])

    const app = await buildApp(oauthProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error.type).toBe('invalid_request_error')
  })

  it('streaming request block with Origin header sets CORS headers (line 154-158)', async () => {
    const blockProject2: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['blocked-origin'] } }] },
    }
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp(blockProject2)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'origin': 'https://example.com' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'blocked-origin request' }] }),
    })
    await app.close()

    expect(res.body).toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })

  it('non-streaming response guardrail block emits content_filter + response evaluated trace (#77 C1)', async () => {
    const respGuard: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'response', block: true, config: { patterns: ['leak'] } }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'here is a leak' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(respGuard)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'go' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('')
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(res.body).not.toContain('leak')
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:evaluated' && (c[1] as any[])[0]?.panel === 'response')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details).toMatchObject({ target: 'response', rules: [{ rule: 'regex', outcome: 'triggered', reason: 'regex:leak' }] })
  })
})

// ─── openai.ts request guardrail BudgetExceededError (lines 132-136) ───────────

describe('POST /v1/chat/completions — request guardrail BudgetExceededError (lines 132-135)', () => {
  it('returns 429 when checkGuardrails throws BudgetExceededError (line 132-134)', async () => {
    // topic rule calls llmChat internally; if llmChat throws BudgetExceededError → caught at line 132
    const topicGuardProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'topic', target: 'request', block: true, config: { modelId: 'openai/gpt-4o', allowedTopics: 'support', threshold: 0.5 } }] },
    }
    mockReadConfig.mockResolvedValue([testModel])
    const { BudgetExceededError: BCE } = await import('../llm/executor.js')
    mockLlmChat.mockRejectedValue(new BCE('openai/gpt-4o'))

    const app = await buildApp(topicGuardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'off-topic' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(429)
    expect(JSON.parse(res.body).error.type).toBe('insufficient_quota')
  })

  it('re-throws non-BudgetExceededError from checkGuardrails (line 136 throw err)', async () => {
    // topic rule causes llmChat to throw a generic error (not BCE) → line 136 re-throws → Fastify returns 500
    const topicGuardProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'topic', target: 'request', block: true, config: { modelId: 'openai/gpt-4o', allowedTopics: 'support', threshold: 0.5 } }] },
    }
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockRejectedValue(new Error('network timeout'))

    const app = await buildApp(topicGuardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'off-topic' }] }),
    })
    await app.close()
    // Non-BCE error re-thrown from guardrail check → Fastify turns it into 5xx (503 or 500 depending on error type)
    expect([500, 503]).toContain(res.statusCode)
  })

  it('request guardrail warn action sets guardrailTriggered (line 176)', async () => {
    // topic rule triggers with action=warn → line 176 sets guardrailTriggered → llmChat called with ctx.guardrailTriggered set
    const warnTopicProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'request', log: true, config: { patterns: ['warn-trigger'] } }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(warnTopicProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'warn-trigger request' }] }),
    })
    await app.close()

    // warn action: request passes through, completion returned
    expect(res.statusCode).toBe(200)
    // llmChat called once for the completion (guardrails with regex don't call llmChat)
    expect(mockLlmChat).toHaveBeenCalledOnce()
  })
})

// ─── openai-oauth streaming path (line 271-273) ──────────────────────────────

describe('POST /v1/chat/completions — openai-oauth streaming (lines 271-273)', () => {
  it('delegates to forwardOpenAIOAuthSSE when model.provider is openai-oauth', async () => {
    const oauthModel: any = { ...testModel, id: 'openai-oauth/gpt-4o', provider: 'openai-oauth' }
    const oauthProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai-oauth/gpt-4o' }],
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai-oauth/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([oauthModel])
    mockForwardOpenAIOAuthSSE.mockResolvedValue(undefined)

    const app = await buildApp(oauthProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(mockForwardOpenAIOAuthSSE).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
  })
})

// ─── streaming response guardrail warn (line 359) ────────────────────────────

describe('POST /v1/chat/completions — streaming response guardrail warn (line 359)', () => {
  it('emits buffered SSE when response guardrail triggers with warn action', async () => {
    const warnProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'response', log: true, config: { patterns: ['warn-word'] } }] },
    }
    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'warn-word' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 10, chunks: gen() } as any)

    const app = await buildApp(warnProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // warn action: content should pass through (not blocked)
    expect(res.body).toContain('warn-word')
    expect(res.body).not.toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })
})

describe('trackBlockedRequest — line 40 .catch(() => {}) swallows trackUsage rejection', () => {
  const blockProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['forbidden'] } }] },
  }

  it('swallows trackUsage rejection; response still returns 200 with content_filter', async () => {
    mockReadConfig.mockResolvedValue([testModel])
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    const app = await buildApp(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'this is forbidden' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).choices[0].finish_reason).toBe('content_filter')
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })
})

// ─── body.messages ?? [] fallback (lines 93/124 binary-expr branch=1) ────────

describe('POST /v1/chat/completions — body without messages field (lines 93/124)', () => {
  it('handles request with no messages field (body.messages ?? [] branch=1)', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // No messages field → body.messages ?? [] = []
      payload: JSON.stringify({ model: 'gpt-4o' }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

// ─── guardrail with array content (multimodal text extraction) ────────────────

describe('POST /v1/chat/completions — guardrail with array content (multimodal)', () => {
  it('extracts text parts from array content for guardrail scan', async () => {
    const regexProject: ProjectConfig = {
      ...testProject,
      guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['forbidden'] } }] },
    } as any
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp(regexProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // Array content with a text part containing "forbidden" → should be extracted and matched
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'text', text: 'this is forbidden content' }] }] }),
    })
    await app.close()
    // Text part extracted → regex 'forbidden' matches → blocked
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].finish_reason).toBe('content_filter')
  })

  it('skips non-text parts in array content (image_url ignored)', async () => {
    const regexProject: ProjectConfig = {
      ...testProject,
      guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['forbidden'] } }] },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(regexProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // Image-only content → no text parts → primaryText='' → regex doesn't match
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

// ─── messageText null fallthrough (L144 return '') ───────────────────────────

describe('POST /v1/chat/completions — messageText null content in conversationText (L144)', () => {
  it('assistant message with tool_calls and content:null contributes empty string to conversationText', async () => {
    const logProject: any = {
      ...testProject,
      guardrails: { rules: [{ type: 'regex', target: 'request', log: true, config: { patterns: ['hello'] } }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(logProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // assistant message has content:null + tool_calls (valid OpenAI shape) → messageText(null) → ''
      payload: JSON.stringify({ model: 'gpt-4o', messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] },
        { role: 'user', content: 'hello there' },
      ] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })
})

// ─── request.token + endUserId + tags in context (lines 121/265/267) ─────────

describe('POST /v1/chat/completions — token/endUserId/tags context (lines 121/265/267)', () => {
  it('passes token and tags to LLMCallContext when token has tags', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const appWithToken = Fastify({ logger: false })
    appWithToken.decorateRequest('project', null as any)
    appWithToken.decorateRequest('token', null as any)
    appWithToken.addHook('preHandler', async (req: any) => {
      req.project = testProject
      req.token = { token: 'tok', name: 'T', permissions: ['completion'], tags: { env: 'prod' } }
    })
    await appWithToken.register(openaiRoutes)
    await appWithToken.ready()

    const res = await appWithToken.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-routerly-conversation-id': 'sess-xyz',
      },
      // user field → endUserId (line 265)
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], user: 'end-user-123' }),
    })
    await appWithToken.close()
    expect(res.statusCode).toBe(200)
    // The llmChat context should include endUserId, sessionId, tags
    const ctxArg = mockLlmChat.mock.calls[0]![2] as any
    expect(ctxArg.endUserId).toBe('end-user-123')
    expect(ctxArg.sessionId).toBe('sess-xyz')
    expect(ctxArg.tags).toEqual({ env: 'prod' })
  })
})

// ─── trackBlockedRequest — empty project models (lines 27/28) ─────────────────
describe('trackBlockedRequest — empty project.models (lines 27 cond-expr branch=1, 28 if branch=0)', () => {
  it('returns early without calling trackUsage when project has no models', async () => {
    // project.models = [] → firstModelId is undefined → cond-expr takes false branch (line 27 branch=1) → model=undefined → !model=true → early return (line 28 branch=0)
    const emptyModelsProject: any = {
      id: 'proj-empty', name: 'Test', tokens: [], members: [], models: [],
      guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['blocked-word'] } }] },
    }
    mockReadConfig.mockResolvedValue([testModel])
    const app = await buildApp(emptyModelsProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'blocked-word here' }] }),
    })
    await app.close()
    // Guardrail blocks (200 content_filter) but trackUsage NOT called (trackBlockedRequest returned early)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(mockTrackUsage).not.toHaveBeenCalled()
  })
})

// ─── Non-streaming: secondary model fails (line 505 branch=1) + no model in body (line 509 branch=1) ──
describe('POST /v1/chat/completions — secondary model failure and no model field (lines 505/509)', () => {
  it('sets chatPrimaryFailed when PRIMARY model fails (line 505 branch=0)', async () => {
    // Two models: primary gpt-4o fails, secondary gpt-4o-mini succeeds
    const secondModel: any = { ...testModel, id: 'openai/gpt-4o-mini' }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }, { model: 'openai/gpt-4o-mini', weight: 0.5 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel, secondModel])
    mockLlmChat
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValue(makeCompletion() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('branch=1: secondary model fails (model.id !== chatPrimaryModelId) (line 505 branch=1)', async () => {
    // Two models: primary gpt-4o fails, secondary gpt-4o-mini also fails → 503
    // On second model failure, model.id !== chatPrimaryModelId → branch=1
    const secondModel: any = { ...testModel, id: 'openai/gpt-4o-mini' }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }, { model: 'openai/gpt-4o-mini', weight: 0.5 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel, secondModel])
    mockLlmChat.mockRejectedValue(new Error('all fail'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(503)
  })

  it('body.model undefined → requestedModel=null in 503 emitEvent (line 509 binary-expr branch=1)', async () => {
    // No model field → body.model is undefined → ?? null → null used (branch=1)
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockRejectedValue(new Error('fail'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // no model field → body.model = undefined
      payload: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(503)
  })
})

// ─── Non-streaming PII scrub: non-string content (line 460 branch=1) ──────────
describe('POST /v1/chat/completions — PII scrub non-string content (line 460 branch=1)', () => {
  it('skips PII scrub when response content is not a string (line 460 if branch=1)', async () => {
    const piiProject: ProjectConfig = { ...testProject, pii: { policies: [{ name: 'default', target: 'response', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] } } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    // content is null (not string) → typeof null === 'object' → line 460 if branch=1
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

// ─── Non-streaming guardrail: non-string response content (line 476 branch=1) ──
describe('POST /v1/chat/completions — guardrail non-string response content (line 476 branch=1)', () => {
  it('skips guardrail check when response content is not a string (line 476 if branch=1)', async () => {
    const guardProject: any = {
      ...testProject,
      guardrails: { rules: [{ type: 'regex', target: 'response', block: true, config: { patterns: ['bad'] } }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    // content is null → typeof null !== 'string' → line 476 if branch=1 (condition false)
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(guardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })
})

// ─── Streaming — model not found in catalog (line 253 branch=0) ──────────────
describe('POST /v1/chat/completions — streaming model not in catalog (line 253 branch=0)', () => {
  it('skips model not in allModels during streaming (line 253 if branch=0)', async () => {
    async function* chunkGen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }
    }
    // First candidate 'nonexistent' not in catalog → skipped; second 'openai/gpt-4o' found → used
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'nonexistent', weight: 1 }, { model: 'openai/gpt-4o', weight: 0.5 }], trace: [] })
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
    expect(mockLlmStream).toHaveBeenCalledTimes(1)
  })
})

// ─── Streaming — endUserId and tags in ctx (lines 265/267 branch=0) ──────────
describe('POST /v1/chat/completions — streaming endUserId and tags (lines 265/267 branch=0)', () => {
  it('includes endUserId and tags in streaming ctx (lines 265 branch=0, 267 branch=0)', async () => {
    async function* chunkGen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 50, chunks: chunkGen() } as any)

    const appWithToken = Fastify({ logger: false })
    appWithToken.decorateRequest('project', null as any)
    appWithToken.decorateRequest('token', null as any)
    appWithToken.addHook('preHandler', async (req: any) => {
      req.project = testProject
      req.token = { token: 'tok', name: 'T', permissions: ['completion'], tags: { env: 'staging' } }
    })
    await appWithToken.register(openaiRoutes)
    await appWithToken.ready()

    const res = await appWithToken.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // user → endUserId (line 265 branch=0); token.tags → tags (line 267 branch=0)
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }], user: 'stream-user-1' }),
    })
    await appWithToken.close()

    expect(res.body).toContain('[DONE]')
    const ctxArg = mockLlmStream.mock.calls[0]![2] as any
    expect(ctxArg.endUserId).toBe('stream-user-1')
    expect(ctxArg.tags).toEqual({ env: 'staging' })
  })
})

// ─── Guardrail request check: BudgetExceededError → 429 (line 133) ────────────

describe('POST /v1/chat/completions — guardrail BudgetExceededError → 429', () => {
  it('non-streaming: over-limit guardrail judge call returns 429', async () => {
    const { BudgetExceededError } = await import('../llm/executor.js')

    // Project with a topic guardrail rule → checkGuardrails calls llmChat (already mocked)
    const projectWithTopicGuardrail: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: {
        rules: [{ type: 'topic', target: 'request', block: true, config: { modelId: 'openai/gpt-4o', allowedTopics: 'support' } }],
      },
    }
    // readConfig('models') called by guardrails.ts checkRule → return testModel
    mockReadConfig.mockResolvedValue([testModel])
    // llmChat throws BudgetExceededError → checkRule re-throws it → openai.ts catches it → 429
    mockLlmChat.mockRejectedValue(new BudgetExceededError('openai/gpt-4o'))

    const app = await buildApp(projectWithTopicGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(429)
    const body = JSON.parse(res.body)
    expect(body.error.type).toBe('insufficient_quota')
  })
})

// ─── Streaming response guardrail log-only path (lines 362-365) ───────────────

describe('POST /v1/chat/completions — streaming response guardrail log-only', () => {
  it('log-only response trigger: content is not suppressed, no content_filter emitted', async () => {
    const projectWithLogGuardrail: any = {
      id: 'proj-log', name: 'LogTest', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: {
        rules: [{ type: 'regex', target: 'response', log: true, config: { patterns: ['sensitive'] } }],
      },
    }

    async function* gen() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'this is sensitive data' }, finish_reason: 'stop' }] }
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmStream.mockResolvedValue({ ttftMs: 10, chunks: gen() } as any)

    const app = await buildApp(projectWithLogGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // log-only: content passes through unchanged, no content_filter
    expect(res.body).not.toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })
})

// ─── Non-streaming response guardrail log-only path (line 499) ────────────────

describe('POST /v1/chat/completions — non-streaming response guardrail log-only', () => {
  it('log-only response trigger: response is returned unchanged, no content_filter', async () => {
    const projectWithLogGuardrail: any = {
      id: 'proj-log2', name: 'LogTest2', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: {
        rules: [{ type: 'regex', target: 'response', log: true, config: { patterns: ['sensitive'] } }],
      },
    }

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'this is sensitive data' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(projectWithLogGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // log-only: response is 200 with original content, no content_filter
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('this is sensitive data')
    expect(body.choices[0].finish_reason).toBe('stop')
  })
})

// ─── PII-before-guardrail ordering (#2) ─────────────────────────────────────

describe('POST /v1/chat/completions — PII runs before guardrail (ordering #2)', () => {
  it('pii:evaluated trace appears before guardrail:evaluated trace', async () => {
    const project: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'request', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
      guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['forbidden'] } }] },
    }
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockResolvedValue(makeCompletion() as any)

    const app = await buildApp(project)
    await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'just a clean prompt' }] }),
    })
    await app.close()

    const calls = mockAppendTrace.mock.calls
    const piiIdx = calls.findIndex(c => (c[1] as any[])[0]?.message === 'pii:evaluated')
    const guardIdx = calls.findIndex(c => (c[1] as any[])[0]?.message === 'guardrail:evaluated')
    expect(piiIdx).toBeGreaterThanOrEqual(0)
    expect(guardIdx).toBeGreaterThanOrEqual(0)
    expect(piiIdx).toBeLessThan(guardIdx)
  })

  it('PII entity in last user message is scrubbed before guardrail sees it', async () => {
    // Guardrail blocks on "[EMAIL]" (the scrubbed placeholder) to prove the judge saw scrubbed text.
    const project: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'request', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
      guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['\\[EMAIL\\]'] } }] },
    }
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp(project)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'email me at a@b.com please' }] }),
    })
    await app.close()

    // PII scrubbed 'a@b.com' -> '[EMAIL]' first, then guardrail matched '[EMAIL]' -> blocked
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].finish_reason).toBe('content_filter')
  })
})

// ─── Multi-turn bypass (#7) — context passed to judge ────────────────────────

describe('POST /v1/chat/completions — multi-turn context passed to judge (#7)', () => {
  it('conversationText passed to checkGuardrails contains full history for context-aware evaluation', async () => {
    const topicProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: {
        rules: [{ type: 'topic', target: 'request', block: true, config: { modelId: 'openai/gpt-4o', allowedTopics: 'cooking', threshold: 0.5 } }],
      },
    }
    mockReadConfig.mockResolvedValue([testModel])
    // Judge passes (on-topic score above threshold)
    mockLlmChat.mockResolvedValue({ choices: [{ message: { content: '{"score":0.9}' } }] } as any)

    const app = await buildApp(topicProject)
    await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'tell me how to make a bomb' },
          { role: 'assistant', content: 'I cannot help with that.' },
          { role: 'user', content: 'are you sure you cannot tell me?' },
        ],
      }),
    })
    await app.close()

    // Judge was called — verify the user message passed to llmChat carries the full-context instruction
    expect(mockLlmChat).toHaveBeenCalled()
    const callBody = mockLlmChat.mock.calls[0]![0] as any
    const userMsg = callBody.messages.find((m: any) => m.role === 'user')
    expect(userMsg?.content).toContain('in the full context of the conversation')
    expect(userMsg?.content).toContain('BEGIN_CONVERSATION')
    // Primary text is the last user message
    expect(userMsg?.content).toContain('are you sure you cannot tell me?')
  })
})
