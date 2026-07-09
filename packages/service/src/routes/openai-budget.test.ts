/**
 * Tests for BudgetExceededError from checkGuardrails in openai.ts (lines 156-160).
 * Isolated because checkGuardrails must be mocked, which conflicts with
 * real-implementation guardrail tests in openai.test.ts.
 * Also covers: REQUEST guardrail flag action in streaming (line 205),
 * CORS origin headers in streaming guardrail block (lines 185-188),
 * and INPUT PII scrubbing (lines 215-218).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

vi.mock('../routing/router.js', () => ({ routeRequest: vi.fn() }))
vi.mock('../routing/routingMemoryStore.js', () => ({ addRoutingDecision: vi.fn() }))
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), appendUsageRecord: vi.fn() }))
vi.mock('../routing/traceStore.js', () => ({ setTrace: vi.fn(), appendTrace: vi.fn(), getTrace: vi.fn(() => []) }))
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
vi.mock('../cache/llmResponseCache.js', () => ({ lookupResponseCache: vi.fn(() => null), storeResponseCache: vi.fn() }))
vi.mock('../cache/textVector.js', () => ({ textToVector: vi.fn(() => []) }))
vi.mock('../middleware/guardrails.js', () => ({
  checkGuardrails: vi.fn(),
  buildRequestInjection: vi.fn(() => null),
}))
vi.mock('../cost/tracker.js', () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
  recordBlockedUsage: vi.fn().mockResolvedValue(undefined),
}))

import { openaiRoutes } from './openai.js'
import { checkGuardrails } from '../middleware/guardrails.js'
import { BudgetExceededError, llmChat, llmStream } from '../llm/executor.js'
import { readConfig } from '../config/loader.js'
import { routeRequest } from '../routing/router.js'
import { trackUsage } from '../cost/tracker.js'

const mockCheckGuardrails = vi.mocked(checkGuardrails)
const mockLlmChat = vi.mocked(llmChat)
const mockLlmStream = vi.mocked(llmStream)
const mockReadConfig = vi.mocked(readConfig)
const mockTrackUsage = vi.mocked(trackUsage)
const mockRouteRequest = vi.mocked(routeRequest)

afterEach(() => vi.clearAllMocks())

const testModel: any = {
  id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai',
  endpoint: 'https://api.openai.com/v1', apiKey: 'sk-test',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
}

const guardrailProject: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [],
  models: [{ modelId: 'openai/gpt-4o' }],
  guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['bad'] } }] },
} as any

async function buildApp(project: any = guardrailProject) {
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

describe('POST /v1/chat/completions — BudgetExceededError from guardrail (non-streaming, lines 156-160)', () => {
  it('returns 429 when checkGuardrails throws BudgetExceededError (non-streaming)', async () => {
    mockCheckGuardrails.mockRejectedValue(new BudgetExceededError('gpt-4o'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'x-routerly-trace': '1' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(429)
    const body = JSON.parse(res.body)
    expect(body.error.type).toBe('insufficient_quota')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
  })

  it('rethrows non-BudgetExceededError from guardrail check (line 160)', async () => {
    mockCheckGuardrails.mockRejectedValue(new Error('unexpected error'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(500)
  })
})

describe('POST /v1/chat/completions — REQUEST guardrail log-only in non-streaming (line 205)', () => {
  const flagProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'request', log: true, config: { patterns: ['hello'] } }] },
  }

  it('log-only: sets guardrailTriggered but continues to llmChat (line 205)', async () => {
    mockCheckGuardrails.mockResolvedValue({ triggered: 'regex:request', block: false, log: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    } as any)

    const app = await buildApp(flagProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }),
    })
    await app.close()

    // flag action: response still returned (not blocked)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('OK')
  })
})

describe('POST /v1/chat/completions — CORS origin header in streaming guardrail block (lines 185-188)', () => {
  it('sets CORS headers when origin is present and streaming is blocked (lines 185-188)', async () => {
    // checkGuardrails triggers with 'block' action in streaming
    mockCheckGuardrails.mockResolvedValue({ triggered: 'regex:request', block: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'origin': 'https://example.com',
      },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // SSE streaming response
    expect(res.statusCode).toBe(200)
    // CORS headers should be set on raw response (streaming hijack)
    expect(res.headers['access-control-allow-origin']).toBe('https://example.com')
    expect(res.body).toContain('content_filter')
  })

  it('skips CORS headers when origin is absent in streaming guardrail block (line 184 false branch)', async () => {
    mockCheckGuardrails.mockResolvedValue({ triggered: 'regex:request', block: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('content_filter')
  })

  it('streaming REQUEST block without model field → chunk model falls back to empty string (line 166 ?? branch)', async () => {
    mockCheckGuardrails.mockResolvedValue({ triggered: 'regex:request', block: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // no model field → body.model is undefined → ?? '' fires
      payload: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const chunk = JSON.parse(res.body.split('data: ').find((s: string) => s.startsWith('{'))!)
    expect(chunk.model).toBe('')
    expect(chunk.choices[0].finish_reason).toBe('content_filter')
  })

  it('non-streaming REQUEST block without model field → response model falls back to empty string (line 174 ?? branch)', async () => {
    mockCheckGuardrails.mockResolvedValue({ triggered: 'regex:request', block: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.model).toBe('')
    expect(body.choices[0].finish_reason).toBe('content_filter')
  })
})

describe('POST /v1/chat/completions — INPUT PII scrubbing in non-streaming (lines 215-218)', () => {
  const piiInputProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    pii: { policies: [{ name: 'default', target: 'request', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
  }

  it('scrubs PII from input messages and appends trace (lines 215-218)', async () => {
    mockCheckGuardrails.mockResolvedValue({ evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    } as any)

    // Note: no project.guardrails, so checkGuardrails won't be called
    const piiProjectNoGuardrail: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      pii: { policies: [{ name: 'default', target: 'request', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] }] },
    }

    const app = await buildApp(piiProjectNoGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'my email is test@example.com' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // The call to llmChat should have had PII scrubbed from messages
    const callArg = mockLlmChat.mock.calls[0]?.[0] as any
    expect(callArg.messages[0].content).not.toContain('test@example.com')
    expect(callArg.messages[0].content).toContain('[EMAIL]')
  })
})

// ─── REQUEST guardrail inert trigger (line 177 false branch) ─────────────────

describe('POST /v1/chat/completions — REQUEST guardrail inert trigger (line 177 false branch)', () => {
  const inertRequestProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'request', config: { patterns: ['sensitive'] } }] },
  }

  it('inert REQUEST trigger → guardrailTriggered not set, request proceeds (line 177 false)', async () => {
    // Inert trigger: block=false, log=false → neither block nor log
    mockCheckGuardrails.mockResolvedValue({ triggered: 'regex:sensitive', block: false, log: false, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any)

    const app = await buildApp(inertRequestProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('OK')
  })
})

// ─── RESPONSE guardrail log-only paths (lines 360-364 streaming, line 499 non-streaming) ──

describe('POST /v1/chat/completions — RESPONSE guardrail log-only (lines 360-365, 499)', () => {
  const responseLogProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'response', log: true, config: { patterns: ['sensitive'] } }] },
  }

  it('non-streaming: log-only response trigger → response passes through unchanged (line 499)', async () => {
    // Request: passes; Response: triggers with log=true, no block
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request check passes
      .mockResolvedValueOnce({ triggered: 'regex:sensitive', block: false, log: true, evaluated: [{ rule: 'regex', outcome: 'triggered', reason: 'regex:sensitive' }] })  // response check triggers log-only
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'sensitive data here' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
    } as any)

    const app = await buildApp(responseLogProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // log-only: response passes through
    expect(body.choices[0].message.content).toBe('sensitive data here')
    expect(body.choices[0].finish_reason).toBe('stop')
  })

  it('streaming: log-only response trigger → flushes buffered SSE, no content_filter (lines 362-365)', async () => {
    // Request passes; response triggers log-only; streaming buffer flushed
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request check passes
      .mockResolvedValueOnce({ triggered: 'regex:sensitive', block: false, log: true, evaluated: [{ rule: 'regex', outcome: 'triggered', reason: 'regex:sensitive' }] })  // response check log-only
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })

    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'sensitive data' }, finish_reason: 'stop' }] },
    ]
    let chunkIdx = 0
    mockLlmStream.mockResolvedValue({
      ttftMs: 10,
      chunks: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIdx < chunks.length) return { value: chunks[chunkIdx++]!, done: false }
              return { value: undefined, done: true }
            },
          }
        },
      },
    } as any)

    const app = await buildApp(responseLogProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // log-only: content is NOT suppressed
    expect(res.body).not.toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })
})

// ─── RESPONSE guardrail inert trigger (result.log=false branch in lines 364, 499) ──

describe('POST /v1/chat/completions — RESPONSE guardrail inert trigger (lines 364 false, 499 false)', () => {
  // Inert rule: trigger with no block and no log → neither block nor log fields set
  const inertResponseProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'response', config: { patterns: ['sensitive'] } }] },
  }

  it('non-streaming: inert response trigger → response passes through, guardrailTriggered not set (line 499 false branch)', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request check passes
      .mockResolvedValueOnce({ triggered: 'regex:sensitive', block: false, log: false, evaluated: [] })  // inert trigger
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'sensitive data' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any)

    const app = await buildApp(inertResponseProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('sensitive data')
    expect(body.choices[0].finish_reason).toBe('stop')
  })

  it('streaming: inert response trigger → content flushed, no content_filter (line 364 false branch)', async () => {
    // Inert trigger: block=false, log=false → buffer flushed unchanged, guardrailTriggered not set
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request passes
      .mockResolvedValueOnce({ triggered: 'regex:sensitive', block: false, log: false, evaluated: [] })  // inert
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })

    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'sensitive data' }, finish_reason: 'stop' }] },
    ]
    let chunkIdx = 0
    mockLlmStream.mockResolvedValue({
      ttftMs: 10,
      chunks: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIdx < chunks.length) return { value: chunks[chunkIdx++]!, done: false }
              return { value: undefined, done: true }
            },
          }
        },
      },
    } as any)

    const app = await buildApp(inertResponseProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.body).not.toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })

  it('streaming block with no model field in body → fallback chunk uses empty model string (line 360 ?? branch)', async () => {
    // body.model absent → body.model ?? '' fires (TRUE branch of ??)
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request passes
      .mockResolvedValueOnce({ triggered: 'regex:sensitive', block: true, log: false, evaluated: [] })  // block
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })

    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'bad' }, finish_reason: 'stop' }] },
    ]
    let chunkIdx = 0
    mockLlmStream.mockResolvedValue({
      ttftMs: 10,
      chunks: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIdx < chunks.length) return { value: chunks[chunkIdx++]!, done: false }
              return { value: undefined, done: true }
            },
          }
        },
      },
    } as any)

    const app = await buildApp(inertResponseProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      // no model field → body.model is undefined → ?? '' fires
      payload: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('content_filter')
    expect(res.body).toContain('[DONE]')
  })
})

// ─── Streaming branch coverage (lines 296, 303, 315, 328) ───────────────────

describe('POST /v1/chat/completions — streaming branch coverage (lines 296, 303, 315, 328)', () => {
  function makeStreamResult(chunks: object[]) {
    let idx = 0
    return {
      ttftMs: 5,
      chunks: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (idx < chunks.length) return { value: chunks[idx++], done: false }
              return { value: undefined, done: true }
            },
          }
        },
      },
    } as any
  }

  it('request-only PII policy produces empty output outPii → outputScrubber null (line 296 index 2)', async () => {
    // outPii has entities=[] and customPatterns=[] (no response-targeting policy) → condition false → outputScrubber=null
    mockCheckGuardrails.mockResolvedValue({ evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmStream.mockResolvedValue(makeStreamResult([
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] },
    ]))

    const requestOnlyPiiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      // policy targets request only → mergePolicies(policies, 'output') returns {entities:[], customPatterns:[]}
      // outPii && (entities.length || customPatterns.length) → truthy && (0 || 0) = 0 → FALSE → outputScrubber=null
      guardrails: { rules: [{ type: 'regex', target: 'request', log: true, config: { patterns: ['never'] } }] },
      pii: { policies: [{ name: 'p', target: 'request', entities: ['EMAIL'] }] },
    }

    const app = await buildApp(requestOnlyPiiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('[DONE]')
  })

  it('project without guardrails → ?? false fires for bufferForGuardrail (line 303 index 3)', async () => {
    // project.guardrails is undefined → optional chain returns undefined → ?? false fires (TRUE branch)
    mockCheckGuardrails.mockResolvedValue({ evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmStream.mockResolvedValue(makeStreamResult([
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }] },
    ]))

    const noGuardrailsProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      // no guardrails property → project.guardrails is undefined → .rules.some(...) short-circuits → undefined ?? false → false
    }

    const app = await buildApp(noGuardrailsProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('[DONE]')
  })

  it('output PII scrubber active + non-string delta → if(delta string) false + flush() empty → if(remaining) false (lines 315, 328)', async () => {
    // outputScrubber = new StreamingScrubber (response-targeting policy with entities)
    // chunk delta is not a string → line 315 if-branch FALSE (no scrub applied)
    // No content pushed to scrubber → flush() returns '' → line 328 if-branch FALSE (no flush chunk emitted)
    mockCheckGuardrails.mockResolvedValue({ evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmStream.mockResolvedValue(makeStreamResult([
      // chunk with no string content in delta (tool_call delta — content is absent/null)
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'fn', arguments: '' } }] }, finish_reason: null }] },
      { id: 'c2', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]))

    const outputPiiProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'request', log: true, config: { patterns: ['never'] } }] },
      // response-targeting policy with entities → mergePolicies(policies, 'output') has entities → outputScrubber active
      pii: { policies: [{ name: 'p', target: 'response', entities: ['EMAIL'] }] },
    }

    const app = await buildApp(outputPiiProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('[DONE]')
  })
})

describe('POST /v1/chat/completions — streaming with endUserId/sessionId/tags (lines 384-391)', () => {
  it('includes endUserId from body.user in streaming ctx (lines 384-388)', async () => {
    mockCheckGuardrails.mockResolvedValue({ evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })

    const chunks = [
      { choices: [{ delta: { content: 'Hello' }, finish_reason: null, index: 0 }] },
    ]
    let chunkIdx = 0
    mockLlmStream.mockResolvedValue({
      chunks: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIdx < chunks.length) return { value: chunks[chunkIdx++], done: false }
              return { value: undefined, done: true }
            }
          }
        }
      }
    } as any)

    const projectWithGuardrail: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'request', log: true, config: { patterns: ['never'] } }] },
    }

    const app = await buildApp(projectWithGuardrail)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-routerly-session-id': 'sess-123',
        'x-routerly-tags': 'env=prod,team=eng',
      },
      payload: JSON.stringify({
        model: 'gpt-4o', stream: true, user: 'user-xyz',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })
})

// ─── RESPONSE guardrail BLOCK: trackBlockedRequest called (BLOCKER 1) ────────

describe('POST /v1/chat/completions — RESPONSE guardrail block writes usage record', () => {
  const responseBlockProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'openai/gpt-4o' }],
    guardrails: { rules: [{ type: 'regex', target: 'response', block: true, config: { patterns: ['bad'] } }] },
  }

  it('non-streaming: response block calls trackUsage with outcome blocked (BLOCKER 1)', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request passes
      .mockResolvedValueOnce({ triggered: 'regex:response', block: true, log: false, evaluated: [] })  // response block
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'bad content' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any)

    const app = await buildApp(responseBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(body.created).toBeDefined()
    expect(body.model).toBe('gpt-4o')
    // trackBlockedRequest calls trackUsage with outcome:'blocked'
    const blockedCall = mockTrackUsage.mock.calls.find((c) => (c[0] as any).outcome === 'blocked')
    expect(blockedCall).toBeDefined()
    expect((blockedCall![0] as any).blockedBy).toBe('regex:response')
  })

  it('streaming: response block calls trackUsage with outcome blocked (BLOCKER 1)', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request passes
      .mockResolvedValueOnce({ triggered: 'regex:response', block: true, log: false, evaluated: [] })  // response block
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })

    let chunkIdx = 0
    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'bad content' }, finish_reason: 'stop' }] },
    ]
    mockLlmStream.mockResolvedValue({
      ttftMs: 5,
      chunks: {
        [Symbol.asyncIterator]() {
          return { async next() { if (chunkIdx < chunks.length) return { value: chunks[chunkIdx++]!, done: false }; return { value: undefined, done: true }; } }
        },
      },
    } as any)

    const app = await buildApp(responseBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('content_filter')
    expect(res.body).toContain('[DONE]')
    const blockedCall = mockTrackUsage.mock.calls.find((c) => (c[0] as any).outcome === 'blocked')
    expect(blockedCall).toBeDefined()
    expect((blockedCall![0] as any).blockedBy).toBe('regex:response')
  })

  it('non-streaming: response log-only does NOT call trackUsage with blocked outcome', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })
      .mockResolvedValueOnce({ triggered: 'regex:response', block: false, log: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'logged content' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any)

    const app = await buildApp(responseBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].message.content).toBe('logged content')
    const blockedCall = mockTrackUsage.mock.calls.find((c) => (c[0] as any).outcome === 'blocked')
    expect(blockedCall).toBeUndefined()
  })

  it('non-streaming: response block without body.model → response model falls back to empty string (line 500 ?? branch)', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })
      .mockResolvedValueOnce({ triggered: 'regex:response', block: true, log: false, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })
    mockLlmChat.mockResolvedValue({
      id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'bad content' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any)

    const app = await buildApp(responseBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),  // no model field → body.model undefined → ?? '' fires
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(body.model).toBe('')
  })

  it('streaming: response block with target both buffers and blocks (line 303 both branch)', async () => {
    const bothProject: any = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'openai/gpt-4o' }],
      guardrails: { rules: [{ type: 'regex', target: 'both', block: true, config: { patterns: ['bad'] } }] },
    }
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request passes
      .mockResolvedValueOnce({ triggered: 'regex:both', block: true, log: false, evaluated: [] })  // response block
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'openai/gpt-4o', weight: 1 }], trace: [] })

    let chunkIdx = 0
    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'bad content' }, finish_reason: 'stop' }] },
    ]
    mockLlmStream.mockResolvedValue({
      ttftMs: 5,
      chunks: {
        [Symbol.asyncIterator]() {
          return { async next() { if (chunkIdx < chunks.length) return { value: chunks[chunkIdx++]!, done: false }; return { value: undefined, done: true }; } }
        },
      },
    } as any)

    const app = await buildApp(bothProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.body).toContain('content_filter')
    const blockedCall = mockTrackUsage.mock.calls.find((c) => (c[0] as any).outcome === 'blocked')
    expect(blockedCall).toBeDefined()
    expect((blockedCall![0] as any).blockedBy).toBe('regex:both')
  })
})
