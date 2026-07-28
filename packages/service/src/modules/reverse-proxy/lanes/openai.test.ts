import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../../../core/index.js'
import { openaiTransportProcessors, openaiEgress, openaiInject } from './openai.js'
import type { ProxyContext } from '../context.js'

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
  })

  it('egress writes a json result via reply.send and honors trace opt-in', async () => {
    const sent: unknown[] = []
    const headers: Record<string, string> = {}
    const reply: any = { send: (b: unknown) => sent.push(b), header: (k: string, v: string) => { headers[k] = v }, code: () => reply }
    const ctx = {
      protocol: 'openai', reply, traceEnabled: true, traceId: 't1',
      result: { kind: 'json', body: { object: 'chat.completion' } },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(sent).toEqual([{ object: 'chat.completion' }])
    expect(headers['x-routerly-trace-id']).toBe('t1')
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
        protocol: 'openai', reply, traceEnabled: true, traceId: 't1',
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
})
