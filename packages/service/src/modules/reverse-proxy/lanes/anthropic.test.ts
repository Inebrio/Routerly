import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../../../core/index.js'
import { anthropicTransportProcessors, anthropicEgress, anthropicInject } from './anthropic.js'
import type { ProxyContext } from '../context.js'

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
  })

  it('egress sends a block result without the trace header, even when trace is opted in', async () => {
    const sent: unknown[] = []
    let sentStatus: number | undefined
    const headers: Record<string, string> = {}
    const reply: any = {
      send: (b: unknown) => sent.push(b),
      header: (k: string, v: string) => { headers[k] = v },
      status: (c: number) => { sentStatus = c; return reply },
    }
    const ctx = {
      protocol: 'anthropic', reply, traceEnabled: true, traceId: 't1',
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
      protocol: 'anthropic', reply, traceEnabled: false, traceId: 't1',
      original: { model: 'claude', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(hijacked).toBe(false)
    expect(rawHeaders['Content-Type']).toBe('text/event-stream')
    expect(rawHeaders['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
