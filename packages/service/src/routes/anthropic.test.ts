import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

vi.mock('../routing/router.js', () => ({ routeRequest: vi.fn() }))
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../routing/traceStore.js', () => ({ setTrace: vi.fn(), appendTrace: vi.fn() }))
vi.mock('../llm/executor.js', () => ({
  llmMessages: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {
    override name = 'BudgetExceededError'
    modelId: string
    constructor(modelId: string) { super('budget_exceeded'); this.modelId = modelId }
  },
}))
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn(() => Promise.resolve()) }))

import { anthropicRoutes } from './anthropic.js'
import { routeRequest } from '../routing/router.js'
import { readConfig } from '../config/loader.js'
import { appendTrace } from '../routing/traceStore.js'
import { llmMessages } from '../llm/executor.js'
import { trackUsage } from '../cost/tracker.js'

const mockRouteRequest = vi.mocked(routeRequest)
const mockReadConfig = vi.mocked(readConfig)
const mockAppendTrace = vi.mocked(appendTrace)
const mockLlmMessages = vi.mocked(llmMessages)
const mockTrackUsage = vi.mocked(trackUsage)

afterEach(() => vi.clearAllMocks())

const testProject: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
}

const testModel: any = {
  id: 'm1', name: 'Model 1', provider: 'anthropic',
  endpoint: 'https://api.anthropic.com', apiKey: 'sk-ant-test',
  cost: { inputPerMillion: 3, outputPerMillion: 15 },
}

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('project', null as any)
  app.decorateRequest('token', null as any)
  app.addHook('preHandler', async (req: any) => {
    req.project = testProject
    req.token = undefined
  })
  await app.register(anthropicRoutes)
  await app.ready()
  return app
}

function makeMessagesResponse() {
  return {
    id: 'msg-1', type: 'message', role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }], model: 'm1', stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  }
}

describe('POST /v1/messages', () => {
  it('routes and returns Anthropic-format response', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-3-haiku', max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.type).toBe('message')
    expect(body.content[0].text).toBe('Hello!')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
  })

  it('returns 503 when routing fails', async () => {
    mockRouteRequest.mockRejectedValue(new Error('no models configured'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(503)
    const body = JSON.parse(res.body)
    expect(body.error.type).toBe('overloaded_error')
  })

  it('returns 503 when all candidates fail', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockRejectedValue(new Error('provider error'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(503)
  })

  it('invokes emit callback (line 31) when routeRequest calls it, triggering appendTrace', async () => {
    mockRouteRequest.mockImplementation(async (_body, _project, _log, emit) => {
      // Simulate the routing layer emitting a trace entry via the emit callback
      emit?.({ type: 'routing', modelId: 'm1', reason: 'test' } as any)
      return { models: [{ model: 'm1', weight: 1 }], trace: [] }
    })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-3-haiku', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // appendTrace should have been called once by emit (line 31)
    expect(mockAppendTrace).toHaveBeenCalledWith(expect.any(String), [{ type: 'routing', modelId: 'm1', reason: 'test' }])
  })

  it('silently continues on BudgetExceededError (line 70 false branch)', async () => {
    const { BudgetExceededError: BCE } = await import('../llm/executor.js')
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockRejectedValue(new BCE('m1'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-3', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    // All candidates exhausted (BudgetExceededError) → 503
    expect(res.statusCode).toBe(503)
  })

  it('skips model not found in allModels list', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'nonexistent', weight: 1 }, { model: 'm1', weight: 0.5 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(mockLlmMessages).toHaveBeenCalledTimes(1) // only called for 'm1', not 'nonexistent'
  })
})

describe('POST /v1/messages/count_tokens', () => {
  it('estimates token count from message content', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello world' }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(typeof body.input_tokens).toBe('number')
    expect(body.input_tokens).toBeGreaterThan(0)
  })

  it('counts tokens with system prompt', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })
    await app.close()

    const body = JSON.parse(res.body)
    expect(body.input_tokens).toBeGreaterThan(0)
  })

  it('counts tokens with array content parts', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Tell me about the image' }] }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('handles content that is neither string nor array (line 96 else-if false branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: null }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // null content → neither string nor array → adds nothing
    expect(JSON.parse(res.body).input_tokens).toBe(0)
  })

  it('skips array parts with no text field (line 98 false branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: [{ type: 'image_url', url: 'http://x.com/img.png' }] }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // image part has no text → adds nothing
    expect(JSON.parse(res.body).input_tokens).toBe(0)
  })

  it('returns 0 tokens when messages is absent (covers line 93 || [] branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'm', max_tokens: 100 }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).input_tokens).toBe(0)
  })
})

describe('POST /v1/messages — additional branch coverage', () => {
  it('JSON.stringifies non-string message content (covers line 22 cond-expr FALSE branch)', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-3', max_tokens: 100,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('returns 503 with String(err) when routeRequest throws non-Error (covers line 39 cond-expr FALSE branch)', async () => {
    mockRouteRequest.mockRejectedValue('plain string error')

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-3', max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error.message).toContain('plain string error')
  })
})

describe('POST /v1/messages — subscription (anthropic-oauth) pass-through', () => {
  const oauthModel: any = {
    id: 'm1', name: 'Claude Max', provider: 'anthropic-oauth',
    endpoint: 'https://api.anthropic.com', apiKey: 'sk-ant-oat-stored',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
  }

  it('forwards verbatim with the stored OAuth token and bypasses llmMessages', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'message', id: 'msg_x' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([oauthModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json', authorization: 'Bearer rly-tenant-token' },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 100,
        system: 'You are Claude Code, built by Anthropic.',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(res.json().type).toBe('message')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
    expect(mockLlmMessages).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['authorization']).toBe('Bearer sk-ant-oat-stored')
    expect(init.headers['x-api-key']).toBeUndefined()
  })

  it('regression: API-key anthropic model still uses the SDK path (no fetch)', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel]) // provider: 'anthropic'
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-3', max_tokens: 100,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(mockLlmMessages).toHaveBeenCalledTimes(1)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── Guardrail block + PII trace wire format (#76/#77) ────────────────────────
describe('POST /v1/messages — guardrail block & PII output trace', () => {
  function buildAppWith(project: ProjectConfig) {
    const app = Fastify({ logger: false })
    app.decorateRequest('project', null as any)
    app.decorateRequest('token', null as any)
    app.addHook('preHandler', async (req: any) => { req.project = project; req.token = undefined })
    return app.register(anthropicRoutes).then(() => app.ready()).then(() => app)
  }

  const guardProject: ProjectConfig = {
    id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
    guardrails: { action: 'block', fallbackMessage: 'nope', rules: [{ type: 'regex', target: 'request', config: { patterns: ['forbidden'] } }] },
  } as any

  it('request block returns refusal wire format (empty content, stop_reason refusal, stop_details, trace-id header)', async () => {
    mockReadConfig.mockResolvedValue([testModel])
    const app = await buildAppWith(guardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'this is forbidden' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.content).toEqual([])
    expect(body.stop_reason).toBe('refusal')
    expect(body.stop_details).toEqual({ type: 'refusal' })
    expect(body.content).not.toContainEqual({ type: 'text', text: 'nope' })
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
    // trace carries the readable reason for the dashboard
    const traceCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:triggered')
    expect(traceCall).toBeDefined()
    expect((traceCall![1] as any[])[0].details).toMatchObject({ action: 'block', fallbackMessage: 'nope', target: 'request' })
    expect(mockLlmMessages).not.toHaveBeenCalled()
    // C3: blocked request recorded with outcome 'blocked', callType 'guardrail', cost 0, blockedBy set.
    expect(mockTrackUsage).toHaveBeenCalledTimes(1)
    expect(mockTrackUsage.mock.calls[0]![0]).toMatchObject({ projectId: 'proj-1', outcome: 'blocked', callType: 'guardrail', inputTokens: 0, outputTokens: 0, blockedBy: 'regex:forbidden' })
    // C1: evaluation trace appended on the block path.
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:evaluated')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details).toMatchObject({ target: 'request', rules: [{ rule: 'regex', outcome: 'triggered', reason: 'regex:forbidden' }] })
  })

  it('clean request emits guardrail:evaluated passed, no blocked record (#77 C1)', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({ id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'fine' }], model: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } as any)
    const app = await buildAppWith(guardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'all good' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'guardrail:evaluated')
    expect((evalCall![1] as any[])[0].details).toMatchObject({ target: 'request', rules: [{ rule: 'regex', outcome: 'passed' }] })
    expect(mockTrackUsage.mock.calls.find(c => c[0].outcome === 'blocked')).toBeUndefined()
  })

  it('response block returns refusal wire format', async () => {
    const respGuard: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', fallbackMessage: 'nope', rules: [{ type: 'regex', target: 'response', config: { patterns: ['leak'] } }] },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({ id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'this is a leak' }], model: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } as any)

    const app = await buildAppWith(respGuard)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    const body = JSON.parse(res.body)
    expect(body.content).toEqual([])
    expect(body.stop_reason).toBe('refusal')
    expect(body.stop_details).toEqual({ type: 'refusal' })
  })

  it('PII output scrubbing emits a response pii:scrubbed trace entry', async () => {
    const piiProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      pii: { scrubOutput: true },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({ id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'email me at a@b.com' }], model: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } as any)

    const app = await buildAppWith(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    const body = JSON.parse(res.body)
    expect(body.content[0].text).toBe('email me at [EMAIL]')
    const piiTrace = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'response')
    expect(piiTrace).toBeDefined()
    expect((piiTrace![1] as any[])[0].details.entities).toContain('EMAIL')
  })

  it('clean input with PII active emits pii:evaluated (redacted []) and no pii:scrubbed, wire response unchanged', async () => {
    const piiProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      pii: { scrubInput: true },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildAppWith(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'just a clean prompt' }] }),
    })
    await app.close()

    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:evaluated' && (c[1] as any[])[0]?.panel === 'request')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details.redacted).toEqual([])
    const scrubbed = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'request')
    expect(scrubbed).toBeUndefined()
    // wire-format transparency: response body is the standard messages shape, no added fields.
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual(makeMessagesResponse())
  })

  it('input with a PII hit emits BOTH pii:evaluated (entities) and pii:scrubbed', async () => {
    const piiProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      pii: { scrubInput: true },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildAppWith(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'email me at a@b.com' }] }),
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
    const piiProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      pii: { scrubOutput: true },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildAppWith(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).content[0].text).toBe('Hello!')
    const evalCall = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:evaluated' && (c[1] as any[])[0]?.panel === 'response')
    expect(evalCall).toBeDefined()
    expect((evalCall![1] as any[])[0].details.redacted).toEqual([])
    const scrubbed = mockAppendTrace.mock.calls.find(c => (c[1] as any[])[0]?.message === 'pii:scrubbed' && (c[1] as any[])[0]?.panel === 'response')
    expect(scrubbed).toBeUndefined()
  })
})
