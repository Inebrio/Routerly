import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../core/index.js'
import { makeTraceStreamHandler } from './routes.js'
import type { TraceEvent } from './store.js'

function fakeReply() {
  const written: string[] = []
  const headers: Record<string, string> = {}
  const listeners: Record<string, Array<() => void>> = {}
  const status = vi.fn(() => reply)
  const send = vi.fn()
  const reply = {
    status,
    send,
    hijack: vi.fn(),
    raw: {
      setHeader: vi.fn((k: string, v: string) => { headers[k] = v }),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => { written.push(chunk) }),
    },
    _written: written,
    _headers: headers,
    _listeners: listeners,
  }
  return reply
}

function fakeRequest(permissions: string[], query: Record<string, string> = {}) {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    dashUser: { permissions },
    query,
    raw: {
      on: (event: string, fn: () => void) => { (listeners[event] ??= []).push(fn) },
      emit: (event: string) => { for (const fn of listeners[event] ?? []) fn() },
    },
  }
}

const event = (over: Partial<TraceEvent> = {}): TraceEvent => ({
  traceId: 't1',
  routerId: 'p1',
  correlationId: 'c1',
  entry: { panel: 'request', message: 'pii:scrubbed', details: {} },
  ...over,
})

async function open(permissions: string[], query: Record<string, string> = {}) {
  const events = new EventBus()
  const req = fakeRequest(permissions, query)
  const reply = fakeReply()
  await makeTraceStreamHandler(events)(req, reply)
  return { events, req, reply }
}

describe('GET /api/traces/stream', () => {
  it('rejects a caller without report:read', async () => {
    const { reply } = await open(['config:read'])
    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.hijack).not.toHaveBeenCalled()
  })

  it('opens an SSE stream and forwards what the bus publishes', async () => {
    const { events, reply } = await open(['report:read'])
    expect(reply._headers['Content-Type']).toBe('text/event-stream')
    expect(reply._headers['Cache-Control']).toBe('no-cache')
    expect(reply._written[0]).toBe(': open\n\n')

    events.publish('trace/request.preprocess/pii/scrubbed', event())
    const frame = reply._written[1]!
    expect(frame.startsWith('event: trace\ndata: ')).toBe(true)
    const data = JSON.parse(frame.slice('event: trace\ndata: '.length))
    expect(data.traceId).toBe('t1')
    expect(data.topic).toBe('trace/request.preprocess/pii/scrubbed')
    expect(data.entry.message).toBe('pii:scrubbed')
  })

  it('filters by correlationId, routerId and traceId', async () => {
    for (const [query, mismatch] of [
      [{ correlationId: 'c1' }, { correlationId: 'other' }],
      [{ routerId: 'p1' }, { routerId: 'other' }],
      [{ traceId: 't1' }, { traceId: 'other' }],
    ] as Array<[Record<string, string>, Partial<TraceEvent>]>) {
      const { events, reply } = await open(['report:read'], query)
      events.publish('trace/routing/routing/selected', event(mismatch))
      expect(reply._written).toHaveLength(1) // only ': open'
      events.publish('trace/routing/routing/selected', event())
      expect(reply._written).toHaveLength(2)
    }
  })

  it('stops writing once the caller disconnects', async () => {
    const { events, req, reply } = await open(['report:read'])
    req.raw.emit('close')
    events.publish('trace/routing/routing/selected', event())
    expect(reply._written).toEqual([': open\n\n'])
  })
})
