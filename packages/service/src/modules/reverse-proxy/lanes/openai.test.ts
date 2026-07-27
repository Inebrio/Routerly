import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../../../core/index.js'
import { openaiTransportProcessors, openaiEgress } from './openai.js'
import type { ProxyContext } from '../context.js'

describe('openai transport lane', () => {
  it('contributes upstream.execute + routing.execute + egress, all lane-prefixed', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    for (const p of openaiTransportProcessors) reg.contribute(p)
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(['openai:upstream'])
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(['openai:attempt'])
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(['openai:egress'])
    for (const p of openaiTransportProcessors) expect(p.id.startsWith('openai:')).toBe(true)
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
