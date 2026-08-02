import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProcessorRegistry } from '../../../core/index.js'

vi.mock('../execute.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../execute.js')>()
  return { ...actual, llmChat: vi.fn(), llmStream: vi.fn() }
})
vi.mock('./oauthForward.js', () => ({
  forwardAnthropicOAuth: vi.fn().mockResolvedValue(undefined),
  forwardAnthropicApiKey: vi.fn().mockResolvedValue(undefined),
}))

import {
  anthropicTransportProcessors, anthropicEgress, anthropicInject, anthropicUpstream, anthropicAttempt,
  buildAnthropicContext,
} from './anthropic.js'
import { llmChat, llmStream, BudgetExceededError } from '../execute.js'
import { forwardAnthropicOAuth, forwardAnthropicApiKey } from './oauthForward.js'
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
const mockForwardOAuth = vi.mocked(forwardAnthropicOAuth)
const mockForwardApiKey = vi.mocked(forwardAnthropicApiKey)

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

describe('anthropic transport lane', () => {
  it('contributes upstream.prepare + upstream.execute + routing.execute + egress, all lane-prefixed', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    for (const p of anthropicTransportProcessors) reg.contribute(p)
    expect(reg.orderedFor('upstream.prepare').map((p) => p.id)).toEqual(['anthropic:inject'])
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(['anthropic:upstream'])
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(['anthropic:attempt'])
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(['anthropic:egress'])
    for (const p of anthropicTransportProcessors) expect(p.id.startsWith('anthropic:')).toBe(true)
  })

  describe('anthropic:inject', () => {
    it('appends the injection to an existing string system field', async () => {
      const ctx = {
        protocol: 'anthropic',
        requestInjection: 'Follow the guardrail.',
        original: { system: 'Base prompt.' },
      } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Base prompt.\n\nFollow the guardrail.')
    })

    it('sets a new system field when none exists', async () => {
      const ctx = {
        protocol: 'anthropic',
        requestInjection: 'Follow the guardrail.',
        original: {},
      } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Follow the guardrail.')
    })

    it('pushes a text block when the system field is an array of blocks', async () => {
      const ctx = {
        protocol: 'anthropic',
        requestInjection: 'Follow the guardrail.',
        original: { system: [{ type: 'text', text: 'Base.' }] },
      } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toEqual([
        { type: 'text', text: 'Base.' },
        { type: 'text', text: 'Follow the guardrail.' },
      ])
    })

    it('is a no-op when ctx.requestInjection is unset', async () => {
      const ctx = {
        protocol: 'anthropic',
        original: { system: 'Base prompt.' },
      } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Base prompt.')
    })

    it('is a no-op when protocol is not anthropic', async () => {
      const ctx = { protocol: 'openai', requestInjection: 'x', original: { system: 'Base.' } } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Base.')
    })

    it('is a no-op when ctx.result is already set', async () => {
      const ctx = { protocol: 'anthropic', result: { kind: 'json' }, requestInjection: 'x', original: { system: 'Base.' } } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Base.')
    })

    it('sets the field directly when the existing system string is empty/whitespace', async () => {
      const ctx = { protocol: 'anthropic', requestInjection: 'Follow the guardrail.', original: { system: '   ' } } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Follow the guardrail.')
    })

    it('sets ctx.requestInjectionApplied after merging', async () => {
      const ctx = {
        protocol: 'anthropic',
        requestInjection: 'Follow the guardrail.',
        original: {},
      } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect(ctx.requestInjectionApplied).toBe(true)
    })

    it('is a no-op when requestInjectionApplied is already true (re-run on a fallback candidate)', async () => {
      const ctx = {
        protocol: 'anthropic',
        requestInjection: 'Follow the guardrail.',
        requestInjectionApplied: true,
        original: { system: 'Base prompt.' },
      } as unknown as ProxyContext
      await anthropicInject.run(ctx)
      expect((ctx.original as any).system).toBe('Base prompt.')
    })
  })

  it('is a no-op when protocol is not anthropic', async () => {
    let called = false
    const reply: any = { send: () => { called = true } }
    const ctx = { protocol: 'openai', reply, result: { kind: 'json', body: {} } } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('is a no-op when ctx.result is unset', async () => {
    let called = false
    const reply: any = { send: () => { called = true } }
    const ctx = { protocol: 'anthropic', reply } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('egress no-ops on passthrough', async () => {
    let called = false
    const reply: any = { send: () => { called = true }, hijack: () => { called = true } }
    const ctx = { protocol: 'anthropic', reply, result: { kind: 'passthrough' } } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('egress writes a json result with an explicit status, adding no headers of its own', async () => {
    const sent: unknown[] = []
    let sentStatus: number | undefined
    const headers: Record<string, string> = {}
    const reply: any = {
      send: (b: unknown) => sent.push(b),
      header: (k: string, v: string) => { headers[k] = v },
      status: (c: number) => { sentStatus = c; return reply },
    }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      result: { kind: 'json', status: 201, body: { type: 'message' } },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(sent).toEqual([{ type: 'message' }])
    expect(sentStatus).toBe(201)
    expect(headers).toEqual({})
  })

  it('egress no-ops on a block with no body (streaming block already wrote its own bytes)', async () => {
    let called = false
    const reply: any = { send: () => { called = true }, header: () => {}, status: () => { called = true; return reply } }
    const ctx = { protocol: 'anthropic', reply, result: { kind: 'block', status: 503 } } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(called).toBe(false)
  })

  it('egress defaults a block result with no explicit status to 200', async () => {
    let sentStatus: number | undefined
    const reply: any = { send: () => {}, header: () => {}, status: (c: number) => { sentStatus = c; return reply } }
    const ctx = { protocol: 'anthropic', reply, result: { kind: 'block', body: { type: 'error', error: { type: 'overloaded_error', message: 'x' } } } } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(sentStatus).toBe(200)
  })

  it('egress sends a block result without adding any header', async () => {
    const sent: unknown[] = []
    let sentStatus: number | undefined
    const headers: Record<string, string> = {}
    const reply: any = {
      send: (b: unknown) => sent.push(b),
      header: (k: string, v: string) => { headers[k] = v },
      status: (c: number) => { sentStatus = c; return reply },
    }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      result: { kind: 'block', status: 503, body: { type: 'error', error: { type: 'overloaded_error', message: 'All candidate models are budget-exhausted or unavailable.' } } },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(sentStatus).toBe(503)
    expect(sent).toEqual([{ type: 'error', error: { type: 'overloaded_error', message: 'All candidate models are budget-exhausted or unavailable.' } }])
    expect(headers['x-routerly-trace-id']).toBeUndefined()
  })

  it('egress streaming sets raw SSE headers and never hijacks (asymmetry vs OpenAI)', async () => {
    const rawHeaders: Record<string, string> = {}
    const written: string[] = []
    let hijacked = false
    const reply: any = {
      hijack: () => { hijacked = true },
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
      header: () => {}, code: () => reply, send: () => {},
    }
    async function* body() { /* no chunks */ }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      original: { model: 'claude', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(hijacked).toBe(false)
    expect(rawHeaders['Content-Type']).toBe('text/event-stream')
    expect(rawHeaders['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('egress streaming never sets a trace header on the raw stream', async () => {
    const rawHeaders: Record<string, string> = {}
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, write: () => {}, end: () => {} },
    }
    async function* body() { /* no chunks */ }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      original: { model: 'claude', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(rawHeaders['x-routerly-trace-id']).toBeUndefined()
  })

  it('translates OpenAI-shaped stream chunks to Anthropic SSE, using request defaults when usage/model are absent', async () => {
    const written: string[] = []
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body() {
      yield { model: '', choices: [{ delta: {}, finish_reason: null }] }
      yield { choices: [{ delta: {}, finish_reason: 'length' }] }
    }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      original: { model: 'claude-fallback', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    const text = written.join('')
    expect(text).toContain('event: message_start')
    expect(text).toContain('"model":"claude-fallback"')
    expect(text).toContain('event: content_block_start')
    expect(text).toContain('event: ping')
    expect(text).not.toContain('content_block_delta')
    expect(text).toContain('"stop_reason":"max_tokens"')
    expect(text).toContain('event: message_stop')
  })

  it('translates OpenAI-shaped stream chunks to Anthropic SSE, carrying usage/model/content through on a stop finish', async () => {
    const written: string[] = []
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
    }
    async function* body() {
      yield { model: 'claude-x', choices: [{ delta: { content: 'Hi' }, finish_reason: null }], usage: { prompt_tokens: 3 } }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 7 } }
    }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      original: { model: 'claude-fallback', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    const text = written.join('')
    expect(text).toContain('"model":"claude-x"')
    expect(text).toContain('event: content_block_delta')
    expect(text).toContain('"text":"Hi"')
    expect(text).toContain('"stop_reason":"end_turn"')
    expect(text).toContain('"output_tokens":7')
  })

  it('egress streaming catches a mid-stream translation error and still ends the response', async () => {
    let ended = false
    const reply: any = {
      hijack: () => {},
      raw: { setHeader: () => {}, flushHeaders: () => {}, write: () => {}, end: () => { ended = true } },
    }
    async function* body(): AsyncGenerator<unknown> {
      yield { model: 'claude', choices: [{ delta: { content: 'hi' }, finish_reason: null }] }
      throw new Error('mid-stream boom')
    }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      original: { model: 'claude', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(ended).toBe(true)
  })
})

describe('buildAnthropicContext', () => {
  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      body: { model: 'claude-3-5', messages: [], max_tokens: 100, stream: false },
      headers: {},
      log: makeLog(),
      project: { id: 'p1', name: 'P', tokens: [], members: [], models: [] },
      ...overrides,
    } as any
  }

  it('builds the canonical view (original !== request cast) with defaults', () => {
    const req = makeReq()
    const ctx = buildAnthropicContext(req, {} as any)
    expect(ctx.protocol).toBe('anthropic')
    expect(ctx.original).toEqual(req.body)
    expect(ctx.stream).toBe(false)
    expect(ctx.passthrough).toBe(false)
    expect(ctx.conversationId).toBeUndefined()
    expect(ctx.token).toBeUndefined()
    expect(typeof ctx.traceId).toBe('string')
  })

  it('reads stream, conversation id, and token from the request', () => {
    const req = makeReq({
      body: { model: 'claude-3-5', messages: [], max_tokens: 100, stream: true },
      headers: { 'x-routerly-conversation-id': 'conv-1' },
      token: { id: 'tok-1', token: 'abc', createdAt: '2024-01-01' },
    })
    const ctx = buildAnthropicContext(req, {} as any)
    expect(ctx.stream).toBe(true)
    expect(ctx.conversationId).toBe('conv-1')
    expect(ctx.token).toEqual({ id: 'tok-1', token: 'abc', createdAt: '2024-01-01' })
  })
})

describe('anthropic:upstream', () => {
  const model: ModelConfig = {
    id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
  }
  const candidate = { model: 'model-a', weight: 1 }

  it('is a no-op when protocol is not anthropic', async () => {
    const ctx = { protocol: 'openai' } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('is a no-op when ctx.result is already set', async () => {
    const ctx = { protocol: 'anthropic', result: { kind: 'json' } } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no attempt', async () => {
    const ctx = { protocol: 'anthropic', original: {} } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('anthropic-oauth passes through verbatim without touching the response headers', async () => {
    const reply: any = { header: vi.fn() }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      attempt: { model: { ...model, provider: 'anthropic-oauth' }, candidate },
      original: { model: 'claude-3-5', messages: [] }, req: {}, log: makeLog(), project: { id: 'p1' },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(ctx.passthrough).toBe(true)
    expect(reply.header).not.toHaveBeenCalled()
    expect(mockForwardOAuth).toHaveBeenCalledOnce()
    expect(ctx.result).toEqual({ kind: 'passthrough' })
  })

  it.each(['anthropic', 'anthropic-web'] as const)('%s passes through verbatim via the API-key path', async (provider) => {
    const reply: any = { header: vi.fn() }
    const ctx = {
      protocol: 'anthropic', reply, traceId: 't1',
      attempt: { model: { ...model, provider }, candidate },
      original: { model: 'claude-3-5', messages: [] }, req: {}, log: makeLog(), project: { id: 'p1' },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(ctx.passthrough).toBe(true)
    expect(reply.header).not.toHaveBeenCalled()
    expect(mockForwardApiKey).toHaveBeenCalledOnce()
    expect(ctx.result).toEqual({ kind: 'passthrough' })
  })

  it('toChat converts a non-string system, filters non-text content blocks, defaults unset content/stream, and forwards temperature/top_p', async () => {
    mockLlmChat.mockImplementationOnce(async (req) => {
      expect(req.messages[0]).toEqual({ role: 'system', content: JSON.stringify([{ type: 'text', text: 'sys' }]) })
      expect(req.messages[1]).toEqual({ role: 'user', content: 'A' })
      expect(req.messages[3]).toEqual({ role: 'user', content: '' })
      expect(req.messages[2]).toEqual({ role: 'user', content: '' })
      expect(req.stream).toBe(false)
      expect(req.temperature).toBe(0.5)
      expect(req.top_p).toBe(0.9)
      return {
        id: 'chatcmpl-1', object: 'chat.completion', created: 0, model: 'model-a',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as any
    })
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: {
        model: 'claude-3-5', max_tokens: 100, system: [{ type: 'text', text: 'sys' }],
        temperature: 0.5, top_p: 0.9,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'A' }, { type: 'image', url: 'x' }] },
          { role: 'user', content: 123 as unknown as string },
          { role: 'user', content: [{ type: 'text' }] },
        ],
      },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(mockLlmChat).toHaveBeenCalledOnce()
  })

  it('chatToMessages falls back to defaults when id/model/usage/finish_reason are absent or non-terminal', async () => {
    mockLlmChat.mockResolvedValueOnce({
      id: '', object: 'chat.completion', created: 0, model: '',
      choices: [{ index: 0, message: { role: 'assistant', content: undefined as unknown as string }, finish_reason: 'length' }],
    } as any)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 'trace-xyz',
      attempt: { model, candidate },
      original: { model: 'requested-model', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    const body = (ctx.result as any).body
    expect(body.id).toBe('msg_trace-xyz')
    expect(body.content[0].text).toBe('')
    expect(body.stop_reason).toBe('max_tokens')
    expect(body.model).toBe('requested-model')
    expect(body.usage).toEqual({ input_tokens: 0, output_tokens: 0 })
  })

  it('non-Anthropic provider + stream success converts via toChat and sets a stream result', async () => {
    async function* chunks() { yield { id: 'c1' } }
    mockLlmStream.mockImplementationOnce(async (req, _model, cctx) => {
      expect((req.messages as any[])[0]).toEqual({ role: 'system', content: 'You are helpful.' })
      cctx.emit?.({ panel: 'request', message: 'model:request', details: {} })
      return { ttftMs: 1, chunks: chunks() } as any
    })
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: {
        model: 'claude-3-5', stream: true, max_tokens: 100, system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }], user: 'end-user-1',
      },
      token: { id: 'tok-1', token: 'x', createdAt: '2024', tags: { env: 'prod' } },
      guardrailTriggered: 'rule-1', piiRedacted: ['EMAIL'], conversationId: 'conv-1',
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(mockLlmStream).toHaveBeenCalledOnce()
    expect((ctx.result as any).kind).toBe('stream')
  })

  it('non-Anthropic provider + stream failure with a generic error warns and leaves ctx.result unset', async () => {
    mockLlmStream.mockRejectedValueOnce(new Error('boom'))
    const log = makeLog()
    const ctx = {
      protocol: 'anthropic', log, project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: true, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(log.warn).toHaveBeenCalledOnce()
    expect(ctx.result).toBeUndefined()
  })

  it('non-Anthropic provider + stream failure with BudgetExceededError does not warn', async () => {
    mockLlmStream.mockRejectedValueOnce(new BudgetExceededError('model-a'))
    const log = makeLog()
    const ctx = {
      protocol: 'anthropic', log, project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: true, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(log.warn).not.toHaveBeenCalled()
    expect(ctx.result).toBeUndefined()
  })

  it('non-Anthropic provider + non-stream success converts via toChat/chatToMessages and sets a json result', async () => {
    mockLlmChat.mockResolvedValueOnce({
      id: 'chatcmpl-1', object: 'chat.completion', created: 0, model: 'model-a',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: false, max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(mockLlmChat).toHaveBeenCalledOnce()
    expect((ctx.result as any).kind).toBe('json')
    expect((ctx.result as any).body.content[0].text).toBe('hi')
  })

  it('non-Anthropic provider + non-stream failure with a generic error warns and leaves ctx.result unset', async () => {
    mockLlmChat.mockRejectedValueOnce(new Error('boom'))
    const log = makeLog()
    const ctx = {
      protocol: 'anthropic', log, project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: false, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(log.warn).toHaveBeenCalledOnce()
    expect(ctx.result).toBeUndefined()
  })

  it('non-Anthropic provider + non-stream failure with BudgetExceededError does not warn', async () => {
    mockLlmChat.mockRejectedValueOnce(new BudgetExceededError('model-a'))
    const log = makeLog()
    const ctx = {
      protocol: 'anthropic', log, project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: false, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(log.warn).not.toHaveBeenCalled()
    expect(ctx.result).toBeUndefined()
  })

  it('non-stream failure stashes ctx.attemptError/attemptResponse for the resilience attempt loop (Task 7)', async () => {
    const sdkErr = Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '5' } })
    mockLlmChat.mockRejectedValueOnce(sdkErr)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: false, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(ctx.attemptError).toBe(sdkErr)
    expect(ctx.attemptResponse).toEqual({ status: 429, headers: { 'retry-after': '5' } })
  })

  it('stream failure stashes ctx.attemptError/attemptResponse for the resilience attempt loop (Task 7)', async () => {
    const err = new Error('boom')
    mockLlmStream.mockRejectedValueOnce(err)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: true, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(ctx.attemptError).toBe(err)
    expect(ctx.attemptResponse).toBeUndefined()
  })

  it('BudgetExceededError does NOT stash ctx.attemptError (a local skip, not an upstream fault)', async () => {
    mockLlmChat.mockRejectedValueOnce(new BudgetExceededError('model-a'))
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      attempt: { model, candidate },
      original: { model: 'claude-3-5', stream: false, max_tokens: 100, messages: [] },
    } as unknown as ProxyContext
    await anthropicUpstream.run(ctx)
    expect(ctx.attemptError).toBeUndefined()
    expect(ctx.attemptResponse).toBeUndefined()
  })
})

describe('anthropic:attempt', () => {
  const fakeUpstream = (failFor: string[] = []) => ({
    id: 'anthropic:upstream', phase: 'upstream.execute',
    run(ctx: ProxyContext) {
      if (ctx.protocol !== 'anthropic' || ctx.result) return
      const modelId = ctx.attempt!.model.id
      if (failFor.includes(modelId)) return
      ctx.result = { kind: 'json', body: { type: 'message', model: modelId } }
    },
  })

  it('is a no-op when protocol is not anthropic', async () => {
    const ctx = { protocol: 'openai' } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toBeUndefined()
  })

  it('is a no-op when ctx.result is already set', async () => {
    const ctx = { protocol: 'anthropic', result: { kind: 'block', status: 403 } } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
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
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      candidates: [{ model: 'missing-model', weight: 5 }, { model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { type: 'message', model: 'model-a' } })
  })

  it('falls back to the next candidate on failure (no events emitted on this lane)', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
    } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { type: 'message', model: 'model-b' } })
  })

  it('all candidates exhausted: returns a 503 overloaded_error block', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toEqual({
      kind: 'block', status: 503,
      body: { type: 'error', error: { type: 'overloaded_error', message: 'All candidate models are budget-exhausted or unavailable.' } },
    })
  })

  it('defaults ctx.candidates to an empty list when unset, exhausting immediately', async () => {
    await seedModels([])
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(fakeUpstream())
    setProxyPipeline(reg)
    const ctx = { protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1' } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect((ctx.result as any).kind).toBe('block')
  })

  it('short-circuits before upstream.execute when upstream.prepare (budget) sets a block', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const upstreamRun = vi.fn()
    const budgetBlock = {
      id: 'budget:block', phase: 'upstream.prepare',
      run(ctx: ProxyContext) { ctx.result = { kind: 'block', status: 402, body: { type: 'error', error: { type: 'invalid_request_error', message: 'budget' } } } },
    }
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(budgetBlock)
    reg.contribute({ id: 'anthropic:upstream', phase: 'upstream.execute', run: upstreamRun })
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'block', status: 402, body: { type: 'error', error: { type: 'invalid_request_error', message: 'budget' } } })
    expect(upstreamRun).not.toHaveBeenCalled()
  })

  it('applies requestInjection exactly once across a failed-then-succeeded fallback (regression, upstream.prepare re-runs per candidate)', async () => {
    const models: ModelConfig[] = [
      { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    ]
    await seedModels(models)
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(anthropicInject)
    reg.contribute(fakeUpstream(['model-a']))
    setProxyPipeline(reg)
    const ctx = {
      protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
      requestInjection: 'Follow the guardrail.',
      original: { system: 'Base prompt.' },
      candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
    } as unknown as ProxyContext
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'json', body: { type: 'message', model: 'model-b' } })
    expect((ctx.original as any).system).toBe('Base prompt.\n\nFollow the guardrail.')
  })

  // T1: the attempt loop no longer records faults (double-record fix). The single authoritative
  // recorder is handleProviderResult inside llmChat/llmStream; the loop only advances candidates.
  describe('resilience: the attempt loop does not record faults itself', () => {
    afterEach(() => setResilienceStore(undefined as unknown as ResilienceStore))

    const fakeUpstreamWithAttemptError = (failFor: string[] = [], err: unknown = new Error('boom')) => ({
      id: 'anthropic:upstream', phase: 'upstream.execute',
      run(ctx: ProxyContext) {
        if (ctx.protocol !== 'anthropic' || ctx.result) return
        const modelId = ctx.attempt!.model.id
        if (failFor.includes(modelId)) {
          ctx.attemptError = err
          const status = (err as { status?: number }).status
          if (status) {
            const headers = (err as { headers?: Record<string, string> }).headers
            ctx.attemptResponse = { status, ...(headers ? { headers } : {}) }
          }
          return
        }
        ctx.result = { kind: 'json', body: { type: 'message', model: modelId } }
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
      const err = Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '5' } })
      const reg = new ProcessorRegistry<ProxyContext>()
      reg.contribute(fakeUpstreamWithAttemptError(['model-a'], err))
      setProxyPipeline(reg)
      const ctx = {
        protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
        candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
      } as unknown as ProxyContext
      const t0 = Date.now()
      await anthropicAttempt.run(ctx)
      expect(Date.now() - t0).toBeLessThan(200)
      expect(ctx.result).toEqual({ kind: 'json', body: { type: 'message', model: 'model-b' } })
      // The fake upstream bypasses llmChat/handleProviderResult, so nothing records here — proving
      // the loop itself is not a recorder (the old double-record second site is gone).
      expect(store.records).toHaveLength(0)
      expect(ctx.attemptError).toBeUndefined()
    })

    it('does not call store.record when the failure was a budget skip (no ctx.attemptError)', async () => {
      const models: ModelConfig[] = [
        { id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
        { id: 'model-b', name: 'model-b', provider: 'openai', endpoint: 'e', cost: { inputPerMillion: 0, outputPerMillion: 0 } },
      ]
      await seedModels(models)
      const store = makeFakeStore()
      setResilienceStore(store)
      const reg = new ProcessorRegistry<ProxyContext>()
      reg.contribute(fakeUpstream(['model-a']))
      setProxyPipeline(reg)
      const ctx = {
        protocol: 'anthropic', log: makeLog(), project: { id: 'p1' }, traceId: 't1',
        candidates: [{ model: 'model-a', weight: 2 }, { model: 'model-b', weight: 1 }],
      } as unknown as ProxyContext
      await anthropicAttempt.run(ctx)
      expect(ctx.result).toEqual({ kind: 'json', body: { type: 'message', model: 'model-b' } })
      expect(store.records).toHaveLength(0)
    })
  })
})
