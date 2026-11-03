import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TraceEntry } from '@routerly/shared'
import { openTrace, recordTrace, getTrace, getTraceCorrelationId, resetTraceStore } from './store.js'

function makeEntry(message: string): TraceEntry {
  return { panel: 'router-request', message, details: {} }
}

describe('trace store', () => {
  beforeEach(() => {
    resetTraceStore()
  })

  it('returns null for unknown trace id', () => {
    expect(getTrace('nonexistent')).toBeNull()
  })

  it('records entries into an open trace', () => {
    openTrace('trace-1')
    recordTrace({ traceId: 'trace-1', entry: makeEntry('event1') })
    recordTrace({ traceId: 'trace-1', entry: makeEntry('event2') })
    const result = getTrace('trace-1')
    expect(result).toHaveLength(2)
    expect(result![1]!.message).toBe('event2')
  })

  it('drops entries for a trace that was never opened', () => {
    recordTrace({ traceId: 'nonexistent-trace', entry: makeEntry('orphan') })
    expect(getTrace('nonexistent-trace')).toBeNull()
  })

  it('opening the same id again starts an empty trace', () => {
    openTrace('trace-3')
    recordTrace({ traceId: 'trace-3', entry: makeEntry('old') })
    openTrace('trace-3')
    expect(getTrace('trace-3')).toEqual([])
  })

  it('keeps the correlation id the caller sent', () => {
    openTrace('trace-4', { correlationId: 'corr-1', routerId: 'p1' })
    expect(getTraceCorrelationId('trace-4')).toBe('corr-1')
    openTrace('trace-5')
    expect(getTraceCorrelationId('trace-5')).toBeUndefined()
    expect(getTraceCorrelationId('unknown')).toBeUndefined()
  })

  it('stores details in trace entries', () => {
    openTrace('trace-6')
    recordTrace({
      traceId: 'trace-6',
      entry: {
        panel: 'router-response',
        message: 'policy:result:cheapest',
        details: { type: 'cheapest', scores: [{ model: 'm1', point: 0.9 }] },
      },
    })
    expect(getTrace('trace-6')![0]!.details['type']).toBe('cheapest')
  })

  it('cleans up stale traces older than MAX_AGE_MS', () => {
    const realNow = Date.now
    let mockTime = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

    openTrace('old-trace')
    mockTime += 6 * 60 * 1_000
    openTrace('new-trace') // any open triggers the sweep

    expect(getTrace('old-trace')).toBeNull()
    expect(getTrace('new-trace')).toEqual([])

    vi.spyOn(Date, 'now').mockImplementation(realNow)
    vi.restoreAllMocks()
  })
})
