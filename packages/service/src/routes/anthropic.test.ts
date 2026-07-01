import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

vi.mock('../routing/router.js', () => ({ routeRequest: vi.fn() }))
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../routing/traceStore.js', () => ({ setTrace: vi.fn(), appendTrace: vi.fn() }))
vi.mock('../llm/executor.js', () => ({
  llmMessages: vi.fn(),
  llmChat: vi.fn(),
  checkBudget: vi.fn().mockResolvedValue(undefined),
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
import { llmMessages, llmChat, checkBudget } from '../llm/executor.js'
import { trackUsage } from '../cost/tracker.js'

const mockRouteRequest = vi.mocked(routeRequest)
const mockReadConfig = vi.mocked(readConfig)
const mockAppendTrace = vi.mocked(appendTrace)
const mockLlmMessages = vi.mocked(llmMessages)
const mockLlmChat = vi.mocked(llmChat)
const mockTrackUsage = vi.mocked(trackUsage)
const mockCheckBudget = vi.mocked(checkBudget)

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

// ─── Guardrail warn (non-block) and BudgetExceededError paths ────────────────

describe('POST /v1/messages — guardrail warn action and BudgetExceededError (lines 62-66, 85, 200)', () => {
  function buildAppWith(project: ProjectConfig) {
    const app = Fastify({ logger: false })
    app.decorateRequest('project', null as any)
    app.decorateRequest('token', null as any)
    app.addHook('preHandler', async (req: any) => { req.project = project; req.token = undefined })
    return app.register(anthropicRoutes).then(() => app.ready()).then(() => app)
  }

  it('request guardrail warn action: does not block — continues to llmMessages (line 85)', async () => {
    // topic rule triggers but action=warn → guardrailTriggered set, request continues
    const warnProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: {
        action: 'warn',
        rules: [{ type: 'topic', target: 'request', config: { modelId: 'm1', allowedTopics: 'x', threshold: 0.99 } }],
      },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    // llmChat (used by guardrails topic rule) returns score below threshold → triggers
    mockLlmChat.mockResolvedValue({ choices: [{ message: { content: '{"score":0.1}' } }] } as any)
    mockLlmMessages.mockResolvedValue(makeMessagesResponse() as any)

    const app = await buildAppWith(warnProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).type).toBe('message') // not blocked
    expect(mockLlmMessages).toHaveBeenCalled() // passed through
  })

  it('request guardrail BudgetExceededError → 429 (lines 62-65)', async () => {
    const { BudgetExceededError: BCE } = await import('../llm/executor.js')
    const guardProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: {
        action: 'block',
        rules: [{ type: 'topic', target: 'request', config: { modelId: 'm1', allowedTopics: 'x', threshold: 0.5 } }],
      },
    } as any
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmChat.mockRejectedValue(new BCE('m1'))

    const app = await buildAppWith(guardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(429)
    expect(JSON.parse(res.body).error.type).toBe('rate_limit_error')
  })

  it('response guardrail warn action: does not block response (line 200)', async () => {
    const respWarnProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: {
        action: 'warn',
        rules: [{ type: 'regex', target: 'response', config: { patterns: ['secret'] } }],
      },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({
      id: 'msg-1', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'the secret is out' }],
      model: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    } as any)

    const app = await buildAppWith(respWarnProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // response not blocked (warn action) — content passes through
    const body = JSON.parse(res.body)
    expect(body.content[0].text).toBe('the secret is out')
  })
})

// ─── Branch coverage — anthropic.ts uncovered paths ──────────────────────────

describe('anthropic.ts — uncovered branches', () => {
  function buildAppWith(project: ProjectConfig, token?: any) {
    const app = Fastify({ logger: false })
    app.decorateRequest('project', null as any)
    app.decorateRequest('token', null as any)
    app.addHook('preHandler', async (req: any) => { req.project = project; req.token = token ?? undefined })
    return app.register(anthropicRoutes).then(() => app.ready()).then(() => app)
  }

  it('line 23 false: trackBlockedRequest with no models → skips trackUsage (model=undefined)', async () => {
    // Project with no models at all → firstModelId is undefined → model is undefined → early return
    const noModelProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['bad'] } }] },
    } as any
    mockReadConfig.mockResolvedValue([testModel]) // models config has m1 but project has no models
    const app = await buildAppWith(noModelProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'bad' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200) // refusal
    // trackUsage should not be called because there's no model to attribute to
    expect(mockTrackUsage).not.toHaveBeenCalled()
  })

  it('line 36 .catch: swallows trackUsage rejection on blocked request', async () => {
    // trackUsage rejects → .catch(() => {}) fires at line 36
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    mockReadConfig.mockResolvedValue([testModel])
    const blockProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['bad'] } }] },
    } as any
    const app = await buildAppWith(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'bad' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200) // still returns refusal
    expect(JSON.parse(res.body).stop_reason).toBe('refusal')
  })

  it('line 24 true: trackBlockedRequest model not in config → skips trackUsage', async () => {
    // Project references m1 but models config is empty → find returns undefined → early return
    const blockProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['bad'] } }] },
    } as any
    mockReadConfig.mockResolvedValue([]) // no models in config → find returns undefined
    const app = await buildAppWith(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'bad' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(mockTrackUsage).not.toHaveBeenCalled()
  })

  it('line 50 false: guardrailPctx without token (token=undefined)', async () => {
    // token=undefined covers the false branch of ternary at line 50
    const guardProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }] },
    } as any
    mockReadConfig.mockResolvedValue([testModel])
    const app = await buildAppWith(guardProject, undefined) // no token
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200) // no match, passes through llm
  })

  it('line 54 false: body.messages null → uses [] → lastUserMsg undefined → inputText="" (guard matches empty)', async () => {
    // When messages is absent → body.messages ?? [] → []
    // lastUserMsg is undefined → inputText = ''
    // Use a regex that matches the empty string so the guardrail blocks (early return before line 106 crash)
    mockReadConfig.mockResolvedValue([testModel])
    const guardProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['.*'] } }] },
    } as any
    const app = await buildAppWith(guardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      // messages omitted → triggers ?? [] fallback at line 54
      payload: JSON.stringify({ model: 'claude', max_tokens: 100 }),
    })
    await app.close()
    // Regex '.*' matches '' → blocked → early return with refusal
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).stop_reason).toBe('refusal')
  })

  it('line 184 false: response guardrail with non-text content block → responseText=""', async () => {
    // When first content block is not text type → responseText = '' → guardrail skipped
    const respGuardProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'response', config: { patterns: ['bad'] } }] },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({
      id: 'msg-1', type: 'message', role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool_1', name: 'get_weather', input: {} }],
      model: 'm1', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    } as any)
    const app = await buildAppWith(respGuardProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).stop_reason).toBe('tool_use')
  })
})

// ─── Anthropic route: non-BCE throw from checkGuardrails (line 66) ───────────

describe('POST /v1/messages — non-BudgetExceededError from checkGuardrails (line 66 throw)', () => {
  function buildAppWith(project: ProjectConfig) {
    const app = Fastify({ logger: false })
    app.decorateRequest('project', null as any)
    app.decorateRequest('token', null as any)
    app.addHook('preHandler', async (req: any) => { req.project = project; req.token = undefined })
    return app.register(anthropicRoutes).then(() => app.ready()).then(() => app)
  }

  it('re-throws non-BudgetExceededError from checkGuardrails (line 66) via semantic+checkBudget throw', async () => {
    // Use semantic rule: checkBudget is called before try-catch in semantic handler.
    // A non-BCE throw from checkBudget propagates out of checkRule → checkGuardrails → line 66 throw err.
    const semanticProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'semantic', target: 'request', config: { embeddingModelId: 'm1', examples: ['x'], threshold: 0.8 } }] },
    } as any
    mockReadConfig.mockResolvedValue([testModel])
    mockCheckBudget.mockRejectedValueOnce(new Error('disk error'))

    const app = await buildAppWith(semanticProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    // Non-BCE rethrown at line 66 → Fastify returns 5xx
    expect([500, 503]).toContain(res.statusCode)
  })

  it('blocked request with no model field in body uses "unknown" (line 83 body.model ?? "unknown")', async () => {
    const blockProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['blocked'] } }] },
    } as any
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })

    const app = await buildAppWith(blockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      // No model field → body.model ?? 'unknown'
      payload: JSON.stringify({ max_tokens: 100, messages: [{ role: 'user', content: 'blocked text' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.model).toBe('unknown')
    expect(body.stop_reason).toBe('refusal')
  })
})

// ─── Anthropic: endUserId / sessionId / tags (lines 157, 160, 161 cond-expr branch=0) ─

describe('POST /v1/messages — endUserId / sessionId / token.tags (lines 157/160/161 branch=0)', () => {
  it('passes endUserId, sessionId, and token.tags to llmMessages context (lines 157/160/161 branch=0)', async () => {
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({
      id: 'msg-1', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'Hi' }],
      model: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    } as any)

    // Build app with token that has tags
    const appWithToken = Fastify({ logger: false })
    appWithToken.decorateRequest('project', null as any)
    appWithToken.decorateRequest('token', null as any)
    appWithToken.addHook('preHandler', async (req: any) => {
      req.project = testProject
      req.token = { token: 'tok', name: 'T', permissions: ['completion'], tags: { customer: 'acme' } }
    })
    await appWithToken.register(anthropicRoutes)
    await appWithToken.ready()

    const res = await appWithToken.inject({
      method: 'POST', url: '/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-routerly-conversation-id': 'sess-abc',  // → conversationId (line 160)
      },
      // 'user' field → endUserId (line 157)
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], user: 'user-123' }),
    })
    await appWithToken.close()
    expect(res.statusCode).toBe(200)
    // Verify llmMessages was called with endUserId, sessionId, tags in context
    const ctxArg = mockLlmMessages.mock.calls[0]![2] as any
    expect(ctxArg.endUserId).toBe('user-123')
    expect(ctxArg.sessionId).toBe('sess-abc')
    expect(ctxArg.tags).toEqual({ customer: 'acme' })
  })
})

// ─── Anthropic: pii.scrubOutput with non-text content (line 168 if branch=1) ─

describe('POST /v1/messages — pii.scrubOutput with non-text content (line 168)', () => {
  function buildAppWith(project: ProjectConfig) {
    const app = Fastify({ logger: false })
    app.decorateRequest('project', null as any)
    app.decorateRequest('token', null as any)
    app.addHook('preHandler', async (req: any) => { req.project = project; req.token = undefined })
    return app.register(anthropicRoutes).then(() => app.ready()).then(() => app)
  }

  it('skips text scrubbing when content block is not text type (line 168 branch=1)', async () => {
    const piiProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      pii: { scrubOutput: true, entities: ['EMAIL'] },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    // Response has tool_use content (not text) → block.type !== 'text' → skip scrub
    mockLlmMessages.mockResolvedValue({
      id: 'msg-1', type: 'message', role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool_1', name: 'get_weather', input: {} }],
      model: 'm1', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    } as any)

    const app = await buildAppWith(piiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).stop_reason).toBe('tool_use')
  })

  it('body.model ?? "unknown" in response guardrail block (line 198 binary-expr branch=1)', async () => {
    const respBlockProject: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
      guardrails: { action: 'block', rules: [{ type: 'regex', target: 'response', config: { patterns: ['bad'] } }] },
    } as any
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockLlmMessages.mockResolvedValue({
      id: 'msg-1', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'bad content here' }],
      model: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    } as any)

    const app = await buildAppWith(respBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      // No model field → body.model ?? 'unknown'
      payload: JSON.stringify({ max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.model).toBe('unknown')
    expect(body.stop_reason).toBe('refusal')
  })
})
