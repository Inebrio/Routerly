import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ appendUsageRecords: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../trace/store.js', () => ({ getTrace: vi.fn() }))

import { deferRecord, flushTrace, resetPendingUsage } from './pending.js'
import { appendUsageRecords } from '../config/loader.js'
import { getTrace } from '../trace/store.js'

const mockAppend = vi.mocked(appendUsageRecords)
const mockGetTrace = vi.mocked(getTrace)

afterEach(() => {
  resetPendingUsage()
  vi.clearAllMocks()
})

const record = (id: string) => ({ id, traceId: 't1', trace: [] }) as any

describe('pending usage records', () => {
  it('writes nothing until the trace is flushed', async () => {
    mockGetTrace.mockReturnValue(null)
    deferRecord('t1', record('r1'))
    expect(mockAppend).not.toHaveBeenCalled()

    await flushTrace('t1')
    expect(mockAppend).toHaveBeenCalledTimes(1)
    expect(mockAppend.mock.calls[0]![0].map((r) => r.id)).toEqual(['r1'])
  })

  it('stores the trace as it stands at flush time', async () => {
    const entries = [
      { panel: 'request', message: 'model:request', details: {} },
      { panel: 'router-response', message: 'trace:recap', details: { outcome: 'ok' } },
    ]
    mockGetTrace.mockReturnValue(entries as any)
    deferRecord('t1', record('r1'))
    await flushTrace('t1')
    expect(mockAppend.mock.calls[0]![0][0]!.trace).toEqual(entries)
  })

  it('keeps the record trace when the buffer already aged out', async () => {
    mockGetTrace.mockReturnValue(null)
    const held = record('r1')
    held.trace = [{ panel: 'request', message: 'model:request', details: {} }]
    deferRecord('t1', held)
    await flushTrace('t1')
    expect(mockAppend.mock.calls[0]![0][0]!.trace).toHaveLength(1)
  })

  it('writes every record of one trace in a single append', async () => {
    mockGetTrace.mockReturnValue([] as any)
    deferRecord('t1', record('r1'))
    deferRecord('t1', record('r2'))
    await flushTrace('t1')
    expect(mockAppend).toHaveBeenCalledTimes(1)
    expect(mockAppend.mock.calls[0]![0].map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('leaves other traces untouched', async () => {
    mockGetTrace.mockReturnValue([] as any)
    deferRecord('t1', record('r1'))
    deferRecord('t2', record('r2'))
    await flushTrace('t1')
    expect(mockAppend.mock.calls[0]![0].map((r) => r.id)).toEqual(['r1'])

    await flushTrace('t2')
    expect(mockAppend.mock.calls[1]![0].map((r) => r.id)).toEqual(['r2'])
  })

  it('is a no-op for a trace that holds nothing', async () => {
    await flushTrace('unknown')
    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('flushes only once — a second call finds nothing left', async () => {
    mockGetTrace.mockReturnValue([] as any)
    deferRecord('t1', record('r1'))
    await flushTrace('t1')
    await flushTrace('t1')
    expect(mockAppend).toHaveBeenCalledTimes(1)
  })

  it('writes the record on its own when the trace never closes', async () => {
    vi.useFakeTimers()
    mockGetTrace.mockReturnValue([] as any)
    deferRecord('t1', record('r1'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockAppend).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
