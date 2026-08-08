import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../guardrails/guardrails.js', () => ({ checkGuardrails: vi.fn() }))

import {
  buildContentFilterBlock, primaryText, conversationText, wrapWithStreamingScrubber,
  applyResponseScrub, wrapWithResponseGuardrail, assembledResponseText,
} from './helpers.js'
import type { ProxyContext } from './context.js'
import { checkGuardrails } from '../guardrails/guardrails.js'

const mockCheckGuardrails = vi.mocked(checkGuardrails)

afterEach(() => vi.resetAllMocks())

function ctxOf(partial: Partial<ProxyContext>): ProxyContext {
  return { protocol: 'openai', traceId: 't1', request: { model: 'm', messages: [] }, ...partial } as unknown as ProxyContext
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('helpers', () => {
  it('buildContentFilterBlock (openai) is the 200 empty-choice content_filter shape', () => {
    const r = buildContentFilterBlock(ctxOf({ protocol: 'openai', request: { model: 'gpt', messages: [] } as any }))
    expect(r.kind).toBe('block')
    expect(r.status).toBe(200)
    const body = r.body as any
    expect(body.object).toBe('chat.completion')
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(body.choices[0].message.content).toBe('')
  })

  it('buildContentFilterBlock (anthropic) is the refusal shape', () => {
    const r = buildContentFilterBlock(ctxOf({ protocol: 'anthropic', original: { model: 'claude', messages: [] } } as any))
    const body = r.body as any
    expect(body.type).toBe('message')
    expect(body.stop_reason).toBe('refusal')
    expect(body.stop_details).toEqual({ type: 'refusal' })
  })

  it('primaryText picks the last user message; conversationText joins roles', () => {
    const req = { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'bye' }] } as any
    expect(primaryText(req)).toBe('bye')
    expect(conversationText(req)).toBe('user: hi\nassistant: yo\nuser: bye')
  })

  it('wrapWithStreamingScrubber passes chunks through unchanged when the scrubber finds nothing', async () => {
    const effective = { entities: [], customPatterns: [] } as any
    async function* src() {
      yield { choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] }
    }
    const out = await collect(wrapWithStreamingScrubber(src(), effective, ctxOf({})))
    expect((out[1] as any).choices[0].delta.content).toBe('hello')
  })

  it('wrapWithStreamingScrubber traces the response scan once the stream is complete', async () => {
    const emit = vi.fn()
    const effective = { entities: ['EMAIL'], customPatterns: [], outputBufferSize: 5 } as any
    async function* src() {
      yield { choices: [{ index: 0, delta: { content: 'write to a@b.com ' }, finish_reason: null }] }
      yield { choices: [{ index: 0, delta: { content: 'or c@d.com' }, finish_reason: null }] }
    }
    await collect(wrapWithStreamingScrubber(src(), effective, ctxOf({ emit })))
    expect(emit).toHaveBeenCalledWith({
      panel: 'response',
      message: 'pii:evaluated',
      details: {
        target: 'response', mode: 'stream', entities: ['EMAIL'], customPatterns: 0, bufferSize: 5,
        redacted: ['EMAIL'], counts: { EMAIL: 2 },
      },
    })
    expect(emit).toHaveBeenCalledWith({
      panel: 'response', message: 'pii:scrubbed', details: { entities: ['EMAIL'], counts: { EMAIL: 2 } },
    })
  })

  it('assembledResponseText extracts the first choice message content', () => {
    const ctx = ctxOf({ result: { kind: 'json', body: { choices: [{ message: { content: 'hi there' } }] } } as any })
    expect(assembledResponseText(ctx)).toBe('hi there')
  })

  it('assembledResponseText returns empty string when content is absent or non-string', () => {
    expect(assembledResponseText(ctxOf({ result: { kind: 'json', body: { choices: [{ message: {} }] } } as any }))).toBe('')
    expect(assembledResponseText(ctxOf({}))).toBe('')
    expect(assembledResponseText(ctxOf({ result: { kind: 'json', body: { choices: [{ message: { content: 42 } }] } } as any }))).toBe('')
  })

  it('applyResponseScrub mutates the message content in place and returns found entities with counts', () => {
    const body: any = { choices: [{ message: { content: 'write to john@example.com or jane@example.com' } }] }
    const ctx = ctxOf({ result: { kind: 'json', body } as any })
    expect(applyResponseScrub(ctx, { entities: ['EMAIL'], customPatterns: [] }))
      .toEqual({ found: ['EMAIL'], counts: { EMAIL: 2 }, scanned: true })
    expect(body.choices[0].message.content).toBe('write to [EMAIL] or [EMAIL]')
  })

  it('applyResponseScrub reports nothing scanned when content is not a string', () => {
    const body: any = { choices: [{ message: {} }] }
    const ctx = ctxOf({ result: { kind: 'json', body } as any })
    expect(applyResponseScrub(ctx, { entities: ['EMAIL'], customPatterns: [] }))
      .toEqual({ found: [], counts: {}, scanned: false })
    expect(body.choices[0].message).toEqual({})
  })

  it('applyResponseScrub is a no-op when nothing is found', () => {
    const body: any = { choices: [{ message: { content: 'nothing sensitive here' } }] }
    const ctx = ctxOf({ result: { kind: 'json', body } as any })
    expect(applyResponseScrub(ctx, { entities: ['EMAIL'], customPatterns: [] }))
      .toEqual({ found: [], counts: {}, scanned: true })
    expect(body.choices[0].message.content).toBe('nothing sensitive here')
  })

  describe('wrapWithResponseGuardrail', () => {
    const router = {
      guardrails: {
        rules: [{ id: 'r1', enabled: true, block: true, target: 'response' }],
      },
    } as any

    async function* src() {
      yield { choices: [{ index: 0, delta: { content: 'hello ' }, finish_reason: null }] }
      yield { choices: [{ index: 0, delta: { content: 'world' }, finish_reason: null }] }
    }

    it('BLOCK path: drops buffered chunks, yields a single content_filter chunk, sets ctx.blockedBy', async () => {
      mockCheckGuardrails.mockResolvedValue({ triggered: 'r1', block: true, evaluated: [] } as any)
      const ctx = ctxOf({})
      const out = await collect(wrapWithResponseGuardrail(src(), router, {}, { info: vi.fn() } as any, ctx))
      expect(out).toHaveLength(1)
      expect((out[0] as any).choices[0].finish_reason).toBe('content_filter')
      expect((out[0] as any).choices[0].delta).toEqual({})
      expect(ctx.blockedBy).toBe('r1')
    })

    it('PASS-THROUGH path: no block rule configured, all chunks yielded unchanged, blockedBy unset', async () => {
      const passRouter = {} as any
      const ctx = ctxOf({})
      const out = await collect(wrapWithResponseGuardrail(src(), passRouter, {}, { info: vi.fn() } as any, ctx))
      expect(out).toHaveLength(2)
      expect((out[0] as any).choices[0].delta.content).toBe('hello ')
      expect((out[1] as any).choices[0].delta.content).toBe('world')
      expect(ctx.blockedBy).toBeUndefined()
      expect(mockCheckGuardrails).not.toHaveBeenCalled()
    })

    it('PASS-THROUGH path: block rule configured but checkGuardrails does not trigger a block', async () => {
      mockCheckGuardrails.mockResolvedValue({ evaluated: [] } as any)
      const ctx = ctxOf({})
      const out = await collect(wrapWithResponseGuardrail(src(), router, {}, { info: vi.fn() } as any, ctx))
      expect(out).toHaveLength(2)
      expect((out[0] as any).choices[0].delta.content).toBe('hello ')
      expect((out[1] as any).choices[0].delta.content).toBe('world')
      expect(ctx.blockedBy).toBeUndefined()
    })
  })
})
