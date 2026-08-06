import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProcessorRegistry } from '../../../core/index.js'

vi.mock('../execute.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../execute.js')>()
  return { ...actual, llmChat: vi.fn(), llmStream: vi.fn() }
})
vi.mock('../../notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
// Only the network-touching exports are stubbed: primeStream is pure and the lane's
// fallback behaviour depends on it actually pulling the first chunk.
vi.mock('./openaiOAuthForward.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./openaiOAuthForward.js')>()),
  forwardOpenAIOAuthSSE: vi.fn().mockResolvedValue(undefined),
  streamOpenAIOAuthChunks: vi.fn(() => (async function* () {})()),
  chunksToChatResponse: vi.fn().mockResolvedValue({ id: 'chatcmpl-1', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }),
}))

import {
  openaiTransportProcessors, openaiEgress, openaiInject, openaiUpstream, openaiAttempt,
  buildOpenAIContext, buildResponsesContext,
} from './openai.js'
import { llmChat, llmStream, BudgetExceededError } from '../execute.js'
import { emitEvent } from '../../notifications/emitter.js'
import { forwardOpenAIOAuthSSE, streamOpenAIOAuthChunks } from './openaiOAuthForward.js'
import { setProxyPipeline } from '../run.js'
import { writeConfig } from '../../config/loader.js'
import { splitModelsIntoInstancesConnections } from '../../../test-support/effective-models.js'
import { setResilienceStore } from '../../resilience/index.js'
import type { ProxyContext } from '../context.js'
import type { ModelConfig, ResilienceFault, ResilienceKey, ResilienceStore } from '@routerly/shared'

async function seedModels(models: ModelConfig[]): Promise<void> {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  await writeConfig('connections', connections)
  await writeConfig('instances', instances)
}

const mockLlmChat = vi.mocked(llmChat)
const mockLlmStream = vi.mocked(llmStream)
const mockEmitEvent = vi.mocked(emitEvent)
const mockForwardSSE = vi.mocked(forwardOpenAIOAuthSSE)

afterEach(() => vi.clearAllMocks())

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeFakeStore() {
  const records: Array<{ key: ResilienceKey; fault: ResilienceFault }> = []
  const store: ResilienceStore & { records: typeof records } = {
    records,
    record(key, fault) { records.push({ key, fault }) },
    recordSuccess() {},
    isAvailable() { return true },
    tryProbe() { return true },
    snapshot() { return { entries: [], generatedAt: Date.now() } },
    reset() {},
  }
  return store
}

describe('openai transport lane', () => {
  it('contributes upstream.prepare + upstream.execute + routing.execute + egress, all lane-prefixed', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    for (const p of openaiTransportProcessors) reg.contribute(p)
    expect(reg.orderedFor('upstream.prepare').map((p) => p.id)).toEqual(['openai:inject'])
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(['openai:upstream'])
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(['openai:attempt'])
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(['openai:egress'])
    for (const p of openaiTransportProcessors) expect(p.id.startsWith('openai:')).toBe(true)
  })

  describe('openai:inject', () => {
    it('appends the injection to an existing string system message', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        request: { messages: [{ role: 'system', content: 'Base prompt.' }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages[0].content).toBe('Base prompt.\n\nFollow the guardrail.')
    })

    it('unshifts a new system message when none exists', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        request: { messages: [{ role: 'user', content: 'Hi' }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      const messages = (ctx.request as any).messages
      expect(messages[0]).toEqual({ role: 'system', content: 'Follow the guardrail.' })
      expect(messages[1]).toEqual({ role: 'user', content: 'Hi' })
    })

    it('pushes a text block when the system message content is an array of blocks', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        request: { messages: [{ role: 'system', content: [{ type: 'text', text: 'Base.' }] }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages[0].content).toEqual([
        { type: 'text', text: 'Base.' },
        { type: 'text', text: 'Follow the guardrail.' },
      ])
    })

    it('is a no-op when ctx.requestInjection is unset', async () => {
      const messages = [{ role: 'user', content: 'Hi' }]
      const ctx = {
        protocol: 'openai',
        request: { messages },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages).toEqual([{ role: 'user', content: 'Hi' }])
    })

    it('is a no-op when protocol is not openai', async () => {
      const messages = [{ role: 'user', content: 'Hi' }]
      const ctx = { protocol: 'anthropic', requestInjection: 'x', request: { messages } } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages).toEqual([{ role: 'user', content: 'Hi' }])
    })

    it('is a no-op when ctx.result is already set', async () => {
      const messages = [{ role: 'user', content: 'Hi' }]
      const ctx = { protocol: 'openai', result: { kind: 'json' }, requestInjection: 'x', request: { messages } } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages).toEqual([{ role: 'user', content: 'Hi' }])
    })

    it('is a no-op when request.messages is not an array', async () => {
      const ctx = { protocol: 'openai', requestInjection: 'x', request: {} } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages).toBeUndefined()
    })

    it('replaces a non-string, non-array system message content outright', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        request: { messages: [{ role: 'system', content: null }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages[0].content).toBe('Follow the guardrail.')
    })

    it('overwrites an empty-string system message content instead of appending a leading blank line', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        request: { messages: [{ role: 'system', content: '' }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages[0].content).toBe('Follow the guardrail.')
    })

    it('sets ctx.requestInjectionApplied after merging', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        request: { messages: [{ role: 'user', content: 'Hi' }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect(ctx.requestInjectionApplied).toBe(true)
    })

    it('is a no-op when requestInjectionApplied is already true (re-run on a fallback candidate)', async () => {
      const ctx = {
        protocol: 'openai',
        requestInjection: 'Follow the guardrail.',
        requestInjectionApplied: true,
        request: { messages: [{ role: 'system', content: 'Base prompt.' }] },
      } as unknown as ProxyContext
      await openaiInject.run(ctx)
      expect((ctx.request as any).messages[0].content).toBe('Base prompt.')
    })
  })

  it('egress writes a json result via reply.send, adding no headers of its own', async () => {
    const sent: unknown[] = []
    const headers: Record<string, string> = {}
    const reply: any = { send: (b: unknown) => sent.push(b), header: (k: string, v: string) => { headers[k] = v }, code: () => reply }
    const ctx = {
      protocol: 'openai', reply, traceId: 't1',
      result: { kind: 'json', body: { object: 'chat.completion' } },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(sent).toEqual([{ object: 'chat.completion' }])
    expect(headers).toEqual({})
  })

  it('egress writes a json result with an explicit status', async () => {
    const sent: unknown[] = []
    let sentStatus: number | undefined
    const headers: Record<string, string> = {}
    const reply: any = {
      send: (b: unknown) => sent.push(b),
      header: (k: string, v: string) => { headers[k] = v },
      code: (c: number) => { sentStatus = c; return reply },
    }
    const ctx = {
      protocol: 'openai', reply, traceId: 't1',
      result: { kind: 'json', status: 201, body: { object: 'chat.completion' } },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(sentStatus).toBe(201)
    expect(headers).toEqual({})
  })

  it('is a no-op when protocol is not openai', async () => {
    let called = false
    const reply: any = { send: () => { called = true } }
    const ctx = { protocol: 'anthropic', reply, result: { kind: 'json', body: {} } } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('is a no-op when ctx.result is unset', async () => {
    let called = false
    const reply: any = { send: () => { called = true } }
    const ctx = { protocol: 'openai', reply } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('egress sends a block result without the trace header, even when trace is opted in', async () => {
    for (const status of [422, 503] as const) {
      const sent: unknown[] = []
      let sentStatus: number | undefined
      const headers: Record<string, string> = {}
      const reply: any = {
        send: (b: unknown) => sent.push(b),
        header: (k: string, v: string) => { headers[k] = v },
        code: (c: number) => { sentStatus = c; return reply },
      }
      const ctx = {
        protocol: 'openai', reply, traceId: 't1',
        result: { kind: 'block', status, body: { error: { message: 'x', type: 'server_error' } } },
      } as unknown as ProxyContext
      await openaiEgress.run(ctx)
      expect(sentStatus).toBe(status)
      expect(sent).toEqual([{ error: { message: 'x', type: 'server_error' } }])
      expect(headers['x-routerly-trace-id']).toBeUndefined()
    }
  })

  it('egress no-ops on passthrough', async () => {
    let called = false
    const reply: any = { send: () => { called = true }, header: () => {}, code: () => reply, hijack: () => { called = true } }
    const ctx = { protocol: 'openai', reply, result: { kind: 'passthrough' } } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('egress traces what it put on the wire, whatever the result kind', async () => {
    const emit = vi.fn()
    const reply: any = { send: () => {}, header: () => {}, code: () => reply }

    await openaiEgress.run({ protocol: 'openai', reply, emit, result: { kind: 'passthrough' } } as unknown as ProxyContext)
    await openaiEgress.run({ protocol: 'openai', reply, emit, traceId: 't1', request: {}, result: { kind: 'json', body: {} } } as unknown as ProxyContext)
    await openaiEgress.run({ protocol: 'openai', reply, emit, result: { kind: 'block', status: 503, body: { error: {} } } } as unknown as ProxyContext)
    await openaiEgress.run({ protocol: 'openai', reply, emit, result: { kind: 'block', status: 422 } } as unknown as ProxyContext)

    expect(emit.mock.calls.map((c) => c[0].details)).toEqual([
      { protocol: 'openai', kind: 'passthrough' },
      { protocol: 'openai', kind: 'json', status: 200 },
      { protocol: 'openai', kind: 'block', status: 503 },
      { protocol: 'openai', kind: 'block', encoding: 'sse', status: 200 },
    ])
    expect(emit.mock.calls[0]![0]).toMatchObject({ panel: 'response', message: 'egress:sent' })
  })

  it('egress counts the SSE frames the client actually received, and names a mid-stream failure', async () => {
    const emit = vi.fn()
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: () => {}, end: () => {} },
    }
    async function* body() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }
      throw new Error('upstream reset')
    }
    const ctx = {
      protocol: 'openai', reply, emit, traceId: 't1', log: { error: vi.fn() },
      req: { headers: {} }, request: { model: 'm' },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(emit).toHaveBeenCalledWith({
      panel: 'response',
      message: 'egress:sent',
      details: { protocol: 'openai', kind: 'stream', encoding: 'sse', frames: 1, bytes: expect.any(Number), error: 'upstream reset' },
    })
  })

  it('egress no-ops on a block with no body (streaming block already wrote its own bytes)', async () => {
    let called = false
    const reply: any = { send: () => { called = true }, header: () => {}, code: () => { called = true; return reply } }
    const ctx = { protocol: 'openai', reply, result: { kind: 'block', status: 422 } } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('egress defaults a block result with no explicit status to 200', async () => {
    let sentStatus: number | undefined
    const sent: unknown[] = []
    const reply: any = {
      send: (b: unknown) => sent.push(b),
      header: () => {},
      code: (c: number) => { sentStatus = c; return reply },
    }
    const ctx = { protocol: 'openai', reply, result: { kind: 'block', body: { error: { message: 'x', type: 'server_error' } } } } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(sentStatus).toBe(200)
  })

  it('egress streams: writes chunks + [DONE] and sets CORS, never trace frames or trace headers', async () => {
    const rawHeaders: Record<string, string> = {}
    const written: string[] = []
    let hijacked = false
    const reply: any = {
      hijack: () => { hijacked = true },
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }
    }
    const ctx = {
      protocol: 'openai', reply, traceId: 't1',
      req: { headers: { origin: 'https://app.example.com' } },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(hijacked).toBe(true)
    expect(rawHeaders['Access-Control-Allow-Origin']).toBe('https://app.example.com')
    expect(rawHeaders['Access-Control-Allow-Credentials']).toBe('true')
    expect(rawHeaders['Access-Control-Expose-Headers']).toBeUndefined()
    expect(rawHeaders['x-routerly-trace-id']).toBeUndefined()
    expect(written.some((w) => w.includes('"type":"trace"'))).toBe(false)
    expect(written.some((w) => w.includes('"content":"hi"'))).toBe(true)
    expect(written.at(-1)).toBe('data: [DONE]\n\n')
  })

  it('egress streams: never injects trace frames, skips CORS when no origin', async () => {
    const rawHeaders: Record<string, string> = {}
    const written: string[] = []
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body() { /* no chunks */ }
    const ctx = {
      protocol: 'openai', reply, traceId: 't1',
      req: { headers: {} },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(rawHeaders['Access-Control-Allow-Origin']).toBeUndefined()
    expect(rawHeaders['x-routerly-trace-id']).toBeUndefined()
    expect(written).toEqual(['data: [DONE]\n\n'])
  })

  it('egress streams: sets CORS without any expose-header', async () => {
    const rawHeaders: Record<string, string> = {}
    const written: string[] = []
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body() { /* no chunks */ }
    const ctx = {
      protocol: 'openai', reply, traceId: 't1',
      req: { headers: { origin: 'https://app.example.com' } },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(rawHeaders['Access-Control-Allow-Origin']).toBe('https://app.example.com')
    expect(rawHeaders['Access-Control-Expose-Headers']).toBeUndefined()
    expect(written).toEqual(['data: [DONE]\n\n'])
  })

  it('egress streams: catches a mid-stream error and still terminates the SSE frame', async () => {
    const written: string[] = []
    const logError = vi.fn()
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body(): AsyncGenerator<unknown> {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [] }
      throw new Error('mid-stream boom')
    }
    const ctx = {
      protocol: 'openai', reply, traceId: 't1',
      req: { headers: {} }, log: { error: logError },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(logError).toHaveBeenCalledOnce()
    expect(written.at(-1)).toBe('data: [DONE]\n\n')
  })
})

describe('buildOpenAIContext', () => {
  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      body: { model: 'gpt-4o', messages: [], stream: false },
      headers: {},
      log: makeLog(),
      project: { id: 'p1', name: 'P', tokens: [], members: [], models: [] },
      ...overrides,
    } as any
  }

  it('builds the identity view (request === original) with defaults', () => {
    const req = makeReq()
    const ctx = buildOpenAIContext(req, {} as any)
    expect(ctx.protocol).toBe('openai')
    expect(ctx.request).toBe(ctx.original)
    expect(ctx.stream).toBe(false)
    expect(ctx.passthrough).toBe(false)
    expect(ctx.conversationId).toBeUndefined()
    expect(ctx.token).toBeUndefined()
    expect(typeof ctx.traceId).toBe('string')
  })

  it('reads stream, conversation id, and token from the request', () => {
    const req = makeReq({
      body: { model: 'gpt-4o', messages: [], stream: true },
      headers: { 'x-routerly-conversation-id': 'conv-1' },
      token: { id: 'tok-1', token: 'abc', createdAt: '2024-01-01' },
    })
    const ctx = buildOpenAIContext(req, {} as any)
    expect(ctx.stream).toBe(true)
    expect(ctx.conversationId).toBe('conv-1')
    expect(ctx.token).toEqual({ id: 'tok-1', token: 'abc', createdAt: '2024-01-01' })
  })
})

describe('/v1/responses on the openai lane', () => {
  function makeReq(body: Record<string, unknown>) {
    return {
      body,
      headers: {},
      log: makeLog(),
      project: { id: 'p1', name: 'P', tokens: [], members: [], models: [] },
    } as any
  }

  it('decodes the Responses body to the chat view and flags the lane', () => {
    const ctx = buildResponsesContext(makeReq({
      model: 'gpt-4o',
      instructions: 'be terse',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      stream: true,
    }), {} as any)
    expect(ctx.protocol).toBe('openai')
    expect(ctx.responsesApi).toBe(true)
    expect(ctx.stream).toBe(true)
    expect(ctx.request.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ])
    expect((ctx.original as any).input).toBeDefined() // the raw body stays untouched
  })

  it('egress encodes a non-streaming answer as a response object', async () => {
    const sent: any[] = []
    const reply: any = { send: (b: unknown) => sent.push(b), header: () => {}, code: () => reply }
    const ctx = {
      protocol: 'openai', responsesApi: true, reply, traceId: 't1',
      request: { model: 'gpt-4o', messages: [] },
      result: {
        kind: 'json',
        body: {
          id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: '42' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        },
      },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(sent[0].object).toBe('response')
    expect(sent[0].status).toBe('completed')
    expect(sent[0].output[0].content[0].text).toBe('42')
  })

  it('egress writes named Responses events, with no [DONE] and no trace frames', async () => {
    const written: string[] = []
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body() {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] }
    }
    const ctx = {
      protocol: 'openai', responsesApi: true, reply, traceId: 't1',
      req: { headers: {} }, request: { model: 'gpt-4o', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(written.every((w) => w.startsWith('event: '))).toBe(true)
    expect(written.some((w) => w.includes('"type":"trace"'))).toBe(false)
    expect(written.some((w) => w.includes('[DONE]'))).toBe(false)
    expect(written[0]).toContain('event: response.created')
    expect(written.at(-1)).toContain('event: response.completed')
  })

  it('egress catches a mid-stream error and still closes the stream', async () => {
    const written: string[] = []
    const logError = vi.fn()
    let ended = false
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => { ended = true } },
    }
    async function* body(): AsyncGenerator<unknown> {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }
      throw new Error('mid-stream boom')
    }
    const ctx = {
      protocol: 'openai', responsesApi: true, reply, traceId: 't1',
      req: { headers: {} }, log: { error: logError }, request: { model: 'gpt-4o', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(logError).toHaveBeenCalledOnce()
    expect(ended).toBe(true)
  })

  it('openai-oauth streams through egress instead of writing OpenAI SSE bytes', async () => {
    const oauthModel: ModelConfig = {
      id: 'sub', name: 'sub', provider: 'openai-oauth', endpoint: 'https://chatgpt.com/backend-api/codex',
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
    }
    vi.mocked(streamOpenAIOAuthChunks).mockReturnValue((async function* () {
      yield { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'sub', choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }] } as any
    })())
    const ctx = {
      protocol: 'openai', responsesApi: true, stream: true, traceId: 't1',
      log: makeLog(), project: { id: 'p1', models: [] }, request: { model: 'sub', messages: [] },
      attempt: { model: oauthModel, candidate: { model: 'sub', weight: 1 } },
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(ctx.result?.kind).toBe('stream')
    expect(forwardOpenAIOAuthSSE).not.toHaveBeenCalled()
  })
})

describe('openai:upstream', () => {
  const model: ModelConfig = {
    id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
  }
  const candidate = { model: 'model-a', weight: 1 }

  it('is a no-op when protocol is not openai', async () => {
    const ctx = { protocol: 'anthropic' } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('is a no-op when ctx.result is already set', async () => {
    const ctx = { protocol: 'openai', result: { kind: 'json' } } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no attempt', async () => {
    const ctx = { protocol: 'openai', request: {} } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('openai-oauth + non-stream collapses the Codex stream into a chat completion', async () => {
    const ctx = {
      protocol: 'openai', stream: false, traceId: 't-nostream',
      attempt: { model: { ...model, provider: 'openai-oauth' }, candidate },
      request: { model: 'gpt-4o', messages: [] }, log: makeLog(),
      project: { id: 'p1' },
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(ctx.result).toEqual({
      kind: 'json',
      body: { id: 'chatcmpl-1', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] },
    })
  })

  it('openai-oauth + stream hijacks, sets SSE/CORS headers, forwards, and marks passthrough', async () => {
    const rawHeaders: Record<string, string> = {}
    let hijacked = false
    let ended = false
    const reply: any = {
      hijack: () => { hijacked = true },
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, end: () => { ended = true } },
    }
    const ctx = {
      protocol: 'openai', stream: true, reply,
      req: { headers: { origin: 'https://app.example.com' } },
      traceId: 't1',
      attempt: { model: { ...model, provider: 'openai-oauth' }, candidate },
      request: { model: 'gpt-4o', messages: [] }, log: makeLog(),
      project: { id: 'p1', pii: undefined },
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(ctx.passthrough).toBe(true)
    expect(hijacked).toBe(true)
    expect(rawHeaders['Access-Control-Allow-Origin']).toBe('https://app.example.com')
    expect(rawHeaders['Access-Control-Expose-Headers']).toBeUndefined()
    expect(rawHeaders['Content-Type']).toBe('text/event-stream')
    expect(rawHeaders['x-routerly-trace-id']).toBeUndefined()
    expect(mockForwardSSE).toHaveBeenCalledOnce()
    expect(ended).toBe(true)
    expect(ctx.result).toEqual({ kind: 'passthrough' })
  })

  it('openai-oauth + stream skips CORS headers when there is no origin', async () => {
    const rawHeaders: Record<string, string> = {}
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, end: () => {} },
    }
    const ctx = {
      protocol: 'openai', stream: true, reply,
      req: { headers: {} }, traceId: 't1',
      attempt: { model: { ...model, provider: 'openai-oauth' }, candidate },
      request: { model: 'gpt-4o', messages: [] }, log: makeLog(),
      project: { id: 'p1' },
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(rawHeaders['Access-Control-Allow-Origin']).toBeUndefined()
    expect(rawHeaders['x-routerly-trace-id']).toBeUndefined()
  })

  it('openai-oauth + stream sets CORS without any expose-header', async () => {
    const rawHeaders: Record<string, string> = {}
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, end: () => {} },
    }
    const ctx = {
      protocol: 'openai', stream: true, reply,
      req: { headers: { origin: 'https://app.example.com' } }, traceId: 't1',
      attempt: { model: { ...model, provider: 'openai-oauth' }, candidate },
      request: { model: 'gpt-4o', messages: [] }, log: makeLog(),
      project: { id: 'p1' },
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(rawHeaders['Access-Control-Allow-Origin']).toBe('https://app.example.com')
    expect(rawHeaders['Access-Control-Expose-Headers']).toBeUndefined()
  })

  it('stream success sets a stream result from llmStream and drives the trace emit callback', async () => {
    async function* chunks() { yield { id: 'c1' } }
    mockLlmStream.mockImplementationOnce(async (_req, _model, cctx) => {
      cctx.emit?.({ panel: 'request', message: 'model:request', details: {} })
      return { ttftMs: 5, chunks: chunks() } as any
    })
    const ctx = {
      protocol: 'openai', stream: true,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [], user: 'end-user-1' }, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      token: { id: 'tok-1', token: 'x', createdAt: '2024', tags: { env: 'prod' } },
      guardrailTriggered: 'rule-1', piiRedacted: ['EMAIL'], conversationId: 'conv-1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(mockLlmStream).toHaveBeenCalledOnce()
    expect((ctx.result as any).kind).toBe('stream')
  })

  it('stream failure with a generic error warns and leaves ctx.result unset (fallback)', async () => {
    mockLlmStream.mockRejectedValueOnce(new Error('boom'))
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: true,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(log.warn).toHaveBeenCalledOnce()
    expect(ctx.result).toBeUndefined()
  })

  it('stream failure with BudgetExceededError does not warn and leaves ctx.result unset', async () => {
    mockLlmStream.mockRejectedValueOnce(new BudgetExceededError('model-a'))
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: true,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(log.warn).not.toHaveBeenCalled()
    expect(ctx.result).toBeUndefined()
  })

  it('non-stream success calls llmChat and sets a json result, logging response details', async () => {
    mockLlmChat.mockResolvedValueOnce({
      id: 'chatcmpl-1', object: 'chat.completion', created: 0, model: 'model-a',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any)
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: false,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(mockLlmChat).toHaveBeenCalledOnce()
    expect((ctx.result as any).kind).toBe('json')
    expect(log.info).toHaveBeenCalledOnce()
  })

  it('non-stream failure with a generic error warns and leaves ctx.result unset (fallback)', async () => {
    mockLlmChat.mockRejectedValueOnce(new Error('boom'))
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: false,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(log.warn).toHaveBeenCalledOnce()
    expect(ctx.result).toBeUndefined()
  })

  it('non-stream failure with BudgetExceededError does not warn and leaves ctx.result unset', async () => {
    mockLlmChat.mockRejectedValueOnce(new BudgetExceededError('model-a'))
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: false,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(log.warn).not.toHaveBeenCalled()
    expect(ctx.result).toBeUndefined()
  })

  it('non-stream failure stashes ctx.attemptError/attemptResponse for the resilience attempt loop (Task 7)', async () => {
    const sdkErr = Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '5' } })
    mockLlmChat.mockRejectedValueOnce(sdkErr)
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: false,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(ctx.attemptError).toBe(sdkErr)
    expect(ctx.attemptResponse).toEqual({ status: 429, headers: { 'retry-after': '5' } })
  })

  it('stream failure stashes ctx.attemptError/attemptResponse for the resilience attempt loop (Task 7)', async () => {
    const err = new Error('boom')
    mockLlmStream.mockRejectedValueOnce(err)
    const log = makeLog()
    const ctx = {
      protocol: 'openai', stream: true,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log,
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(ctx.attemptError).toBe(err)
    expect(ctx.attemptResponse).toBeUndefined()
  })

  it('BudgetExceededError does NOT stash ctx.attemptError (a local skip, not an upstream fault)', async () => {
    mockLlmChat.mockRejectedValueOnce(new BudgetExceededError('model-a'))
    const ctx = {
      protocol: 'openai', stream: false,
      attempt: { model, candidate },
      request: { model: 'model-a', messages: [] }, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
    } as unknown as ProxyContext
    await openaiUpstream.run(ctx)
    expect(ctx.attemptError).toBeUndefined()
    expect(ctx.attemptResponse).toBeUndefined()
  })
})

describe('openai:attempt', () => {
  const fakeUpstream = (failFor: string[] = []) => ({
    id: 'openai:upstream', phase: 'upstream.execute',
    run(ctx: ProxyContext) {
      if (ctx.protocol !== 'openai' || ctx.result) return
      const modelId = ctx.attempt!.model.id
      if (failFor.includes(modelId)) return
      ctx.result = { kind: 'json', body: { object: 'chat.completion', model: modelId } }
    },
  })

  it('is a no-op when protocol is not openai', async () => {
    const ctx = { protocol: 'anthropic' } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toBeUndefined()
  })

  it('is a no-op when ctx.result is already set (blocked upstream of routing)', async () => {
    const ctx = { protocol: 'openai', result: { kind: 'block', status: 403 } } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'block', status: 403 })
  })

  it('skips candidates whose model id is not registered, then succeeds on the next one', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream())
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { model: 'm', messages: [] },
      candidates: [{ model: 'missing-model', weight: 5 }, { model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { object: 'chat.completion', model: 'model-a' } })
  })

  it('falls back to the next candidate on failure and emits routing.fallback_used', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { model: 'm', messages: [] },
      candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { object: 'chat.completion', model: 'model-b' } })
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'routing.fallback_used', 'info',
      expect.objectContaining({ projectId: 'p1', primaryModelId: 'model-a', fallbackModelId: 'model-b' }),
      expect.anything(),
    )
  })

  it('all candidates exhausted, non-streaming: returns a 503 block and emits routing.no_candidates', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { model: 'requested-model', messages: [] },
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({
      kind: 'block', status: 503,
      body: { error: { message: 'All candidate models failed or are budget-exhausted.', type: 'server_error' } },
    })
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'routing.no_candidates', 'critical',
      expect.objectContaining({ projectId: 'p1', requestedModel: 'requested-model' }),
      expect.anything(),
    )
  })

  it('all candidates exhausted, streaming: yields a stop-finish error chunk and emits the failure', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const entries: { message: string }[] = []
    const ctx = {
      protocol: 'openai', stream: true, log: makeLog(),
      project: { id: 'p1' }, traceId: 't-stream-1',
      request: { messages: [] },
      candidates: [{ model: 'model-a', weight: 1 }],
      emit: (e: { message: string }) => entries.push(e),
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect((ctx.result as any).kind).toBe('stream')
    const collected: unknown[] = []
    for await (const chunk of (ctx.result as any).body) collected.push(chunk)
    expect(collected).toHaveLength(1)
    expect((collected[0] as any).choices[0].finish_reason).toBe('stop')
    expect(entries.map((e) => e.message)).toContain('model:error')
  })

  it('defaults ctx.candidates to an empty list when unset, exhausting immediately', async () => {
    await seedModels([])
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream())
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { messages: [] },
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect((ctx.result as any).kind).toBe('block')
  })

  it('exhausted with no requested model defaults the notified requestedModel to null', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { messages: [] },
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'routing.no_candidates', 'critical',
      expect.objectContaining({ requestedModel: null }),
      expect.anything(),
    )
  })

  it('short-circuits before upstream.execute when upstream.prepare (budget) sets a block', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const upstreamRun = vi.fn()
    const budgetBlock = {
      id: 'budget:block', phase: 'upstream.prepare',
      run(ctx: ProxyContext) { ctx.result = { kind: 'block', status: 402, body: { error: { message: 'budget', type: 'server_error' } } } },
    }
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(budgetBlock)
    reg.contribute({ id: 'openai:upstream', phase: 'upstream.execute', run: upstreamRun })
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { model: 'm', messages: [] },
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'block', status: 402, body: { error: { message: 'budget', type: 'server_error' } } })
    expect(upstreamRun).not.toHaveBeenCalled()
  })

  it('does not re-flag primaryFailed for a later non-primary failure', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      { id: 'model-c', name: 'model-c', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a', 'model-b']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      request: { model: 'm', messages: [] },
      candidates: [{ model: 'model-a', weight: 3 }, { model: 'model-b', weight: 2 }, { model: 'model-c', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { object: 'chat.completion', model: 'model-c' } })
  })

  it('applies requestInjection exactly once across a failed-then-succeeded fallback (regression, upstream.prepare re-runs per candidate)', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(openaiInject)
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'openai', stream: false, log: makeLog(),
      project: { id: 'p1' }, traceId: 't1',
      requestInjection: 'Follow the guardrail.',
      request: { model: 'm', messages: [{ role: 'system', content: 'Base prompt.' }] },
      candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
    } as unknown as ProxyContext
    await openaiAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { object: 'chat.completion', model: 'model-b' } })
    expect((ctx.request as any).messages[0].content).toBe('Base prompt.\n\nFollow the guardrail.')
  })

  // ── T1: the attempt loop no longer records faults (double-record fix). The single authoritative
  // recorder is handleProviderResult inside llmChat/llmStream; the loop only advances candidates. ──
  describe('resilience: the attempt loop does not record faults itself', () => {
    afterEach(() => {
      setResilienceStore(undefined as unknown as ResilienceStore)
    })

    const fakeUpstreamWithAttemptError = (failFor: string[], err: unknown) => ({
      id: 'openai:upstream', phase: 'upstream.execute',
      run(ctx: ProxyContext) {
        if (ctx.protocol !== 'openai' || ctx.result) return
        const modelId = ctx.attempt!.model.id
        if (failFor.includes(modelId)) { ctx.attemptError = err; delete ctx.attemptResponse; return }
        ctx.result = { kind: 'json', body: { object: 'chat.completion', model: modelId } }
      },
    })

    it('does not record on a failed candidate (recording is done in handleProviderResult), advances immediately to the next one', async () => {
      const models: ModelConfig[] = [
        { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
        { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      ]
      await seedModels(models)
      const store = makeFakeStore()
      setResilienceStore(store)
      const failErr = Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '5' } })
      const reg = new ProcessorRegistry<ProxyContext>()
      reg.contribute(fakeUpstreamWithAttemptError(['model-a'], failErr))
      setProxyPipeline(reg)
      const t0 = Date.now()
      const ctx = {
        protocol: 'openai', stream: false, log: makeLog(),
        project: { id: 'p1' }, traceId: 't1',
        request: { model: 'm', messages: [] },
        candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
      } as unknown as ProxyContext
      await openaiAttempt.run(ctx)
      expect(Date.now() - t0).toBeLessThan(200) // no in-loop sleep between candidates
      expect(ctx.result).toEqual({ kind: 'json', body: { object: 'chat.completion', model: 'model-b' } })
      // The fake upstream bypasses llmChat/handleProviderResult, so nothing records here — proving
      // the loop itself is not a recorder (the old double-record second site is gone).
      expect(store.records).toHaveLength(0)
      // The stash is cleared so it never leaks to the next candidate.
      expect(ctx.attemptError).toBeUndefined()
    })

    it('does not call store.record when the failure was a budget skip (no ctx.attemptError)', async () => {
      const models: ModelConfig[] = [
        { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      ]
      await seedModels(models)
      const store = makeFakeStore()
      setResilienceStore(store)
      const reg = new ProcessorRegistry<ProxyContext>()
      reg.contribute(fakeUpstream(['model-a'])) // the plain stub: leaves ctx.attemptError unset
      setProxyPipeline(reg)
      const ctx = {
        protocol: 'openai', stream: false, log: makeLog(),
        project: { id: 'p1' }, traceId: 't1',
        request: { model: 'm', messages: [] },
        candidates: [{ model: 'model-a', weight: 1 }],
      } as unknown as ProxyContext
      await openaiAttempt.run(ctx)
      expect(store.records).toHaveLength(0)
    })
  })
})
