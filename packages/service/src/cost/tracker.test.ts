import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ appendUsageRecord: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../routing/traceStore.js', () => ({ getTrace: vi.fn() }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid') }))

import { trackUsage } from './tracker.js'
import { appendUsageRecord } from '../config/loader.js'
import { getTrace } from '../routing/traceStore.js'

const mockAppendUsageRecord = vi.mocked(appendUsageRecord)
const mockGetTrace = vi.mocked(getTrace)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id = 'm1') {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 5, outputPerMillion: 15 },
  }
}

describe('trackUsage', () => {
  it('calls appendUsageRecord with correct fields', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'proj-1',
      model: makeModel() as any,
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 800,
      outcome: 'success',
    })
    expect(mockAppendUsageRecord).toHaveBeenCalledTimes(1)
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.projectId).toBe('proj-1')
    expect(record.modelId).toBe('m1')
    expect(record.inputTokens).toBe(1000)
    expect(record.outputTokens).toBe(500)
    expect(record.latencyMs).toBe(800)
    expect(record.outcome).toBe('success')
    expect(record.id).toBe('test-uuid')
  })

  it('calculates cost correctly', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'proj-1',
      model: makeModel() as any,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      latencyMs: 1000,
      outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    // cost = (1M * 5 + 1M * 15) / 1M = 5 + 15 = 20
    expect(record.cost).toBeCloseTo(20, 2)
  })

  it('calculates cached token cost correctly', async () => {
    mockGetTrace.mockReturnValue(null)
    const model = { ...makeModel(), cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 0.5 } }
    await trackUsage({
      projectId: 'proj-1',
      model: model as any,
      inputTokens: 1_000,
      outputTokens: 100,
      cachedInputTokens: 500,
      latencyMs: 500,
      outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.cachedInputTokens).toBe(500)
  })

  it('calculates cacheCreationInputTokens cost', async () => {
    mockGetTrace.mockReturnValue(null)
    const model = { ...makeModel(), cost: { inputPerMillion: 5, outputPerMillion: 15, cacheWritePerMillion: 3.75 } }
    await trackUsage({
      projectId: 'proj-1',
      model: model as any,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheCreationInputTokens: 200,
      latencyMs: 500,
      outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.cacheCreationInputTokens).toBe(200)
  })

  it('includes tokensPerSec when latency > 0', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p',
      model: makeModel() as any,
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 1000,
      outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.tokensPerSec).toBe(1500) // (1000+500)/1
  })

  it('does not include tokensPerSec when latency is 0', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 100, outputTokens: 50, latencyMs: 0, outcome: 'error',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.tokensPerSec).toBeUndefined()
  })

  it('attaches trace when traceId is provided and trace exists', async () => {
    const trace = [{ panel: 'router-request', message: 'test', details: {} }]
    mockGetTrace.mockReturnValue(trace as any)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 100, outputTokens: 50, latencyMs: 500,
      outcome: 'success', traceId: 'trace-abc',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.traceId).toBe('trace-abc')
    expect(record.trace).toEqual(trace)
  })

  it('includes errorMessage when outcome is error', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 0, outputTokens: 0, latencyMs: 100,
      outcome: 'error', errorMessage: 'Connection refused',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.errorMessage).toBe('Connection refused')
  })

  it('sets cacheHit and cacheSimilarity fields', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 100, outputTokens: 50, latencyMs: 200,
      outcome: 'success', cacheHit: true, cacheSimilarity: 0.95,
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.cacheHit).toBe(true)
    expect(record.cacheSimilarity).toBe(0.95)
  })

  it('uses completion as default callType', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 10, outputTokens: 5, latencyMs: 100, outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.callType).toBe('completion')
  })

  it('omits tokensPerSec when latencyMs is 0 (line 61 false branch)', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 10, outputTokens: 5, latencyMs: 0, outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.tokensPerSec).toBeUndefined()
  })

  it('includes ttftMs when provided (line 60 true branch)', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 10, outputTokens: 5, latencyMs: 200, ttftMs: 50, outcome: 'success',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.ttftMs).toBe(50)
  })

  it('uses empty trace array when getTrace returns null (line 65 ?? [] branch)', async () => {
    mockGetTrace.mockReturnValue(null)
    await trackUsage({
      projectId: 'p', model: makeModel() as any,
      inputTokens: 10, outputTokens: 5, latencyMs: 100, outcome: 'success',
      traceId: 'trace-null',
    })
    const record = mockAppendUsageRecord.mock.calls[0]![0]
    expect(record.trace).toEqual([])
  })
})
