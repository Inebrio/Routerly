import { describe, it, expect, vi } from 'vitest'
import { setTrace, appendTrace, getTrace } from './traceStore.js'
import type { TraceEntry } from './traceStore.js'

function makeEntry(message: string): TraceEntry {
  return { panel: 'router-request', message, details: {} }
}

describe('traceStore', () => {
  it('returns null for unknown trace id', () => {
    expect(getTrace('nonexistent')).toBeNull()
  })

  it('stores and retrieves a trace', () => {
    const entries = [makeEntry('event1'), makeEntry('event2')]
    setTrace('trace-1', entries)
    const result = getTrace('trace-1')
    expect(result).toHaveLength(2)
    expect(result![0]!.message).toBe('event1')
  })

  it('appends entries to an existing trace', () => {
    setTrace('trace-2', [makeEntry('initial')])
    appendTrace('trace-2', [makeEntry('added1'), makeEntry('added2')])
    const result = getTrace('trace-2')
    expect(result).toHaveLength(3)
    expect(result![2]!.message).toBe('added2')
  })

  it('appendTrace does nothing when trace id does not exist', () => {
    appendTrace('nonexistent-trace', [makeEntry('orphan')])
    expect(getTrace('nonexistent-trace')).toBeNull()
  })

  it('overwrites trace when setTrace called again with same id', () => {
    setTrace('trace-3', [makeEntry('old')])
    setTrace('trace-3', [makeEntry('new')])
    const result = getTrace('trace-3')
    expect(result).toHaveLength(1)
    expect(result![0]!.message).toBe('new')
  })

  it('stores details in trace entries', () => {
    const entry: TraceEntry = {
      panel: 'router-response',
      message: 'policy:result:cheapest',
      details: { type: 'cheapest', scores: [{ model: 'm1', point: 0.9 }] },
    }
    setTrace('trace-4', [entry])
    const result = getTrace('trace-4')!
    expect(result[0]!.details['type']).toBe('cheapest')
  })

  it('cleans up stale traces older than MAX_AGE_MS (line 32)', () => {
    const realNow = Date.now
    let mockTime = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

    setTrace('old-trace', [makeEntry('stale')])
    // Advance time past the 5-minute TTL
    mockTime += 6 * 60 * 1_000
    // Trigger cleanup by setting a new trace
    setTrace('new-trace', [makeEntry('fresh')])

    // The old trace should have been removed
    expect(getTrace('old-trace')).toBeNull()
    expect(getTrace('new-trace')).toBeDefined()

    vi.spyOn(Date, 'now').mockImplementation(realNow)
    vi.restoreAllMocks()
  })
})
