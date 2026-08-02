import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../core/index.js'
import { traceTopic, publishTrace } from './publish.js'
import type { TraceEvent } from './store.js'

describe('traceTopic', () => {
  it('splits the message convention into module and event', () => {
    expect(traceTopic('request.preprocess', 'pii:scrubbed')).toBe('trace/request.preprocess/pii/scrubbed')
  })

  it('keeps the remainder of a multi-colon message as the event', () => {
    expect(traceTopic('routing.prepare', 'policy:result:cheapest')).toBe('trace/routing.prepare/policy/result:cheapest')
  })

  it('falls back when phase or event are missing', () => {
    expect(traceTopic(undefined, 'intake')).toBe('trace/unknown/intake/unknown')
  })

  it('never lets a segment introduce a topic separator', () => {
    expect(traceTopic('a/b', 'c/d:e/f')).toBe('trace/a_b/c_d/e_f')
  })
})

describe('publishTrace', () => {
  it('stamps phase, module and timestamp, and publishes on the derived topic', () => {
    const events = new EventBus()
    const seen: Array<{ topic: string; payload: TraceEvent }> = []
    events.subscribe('trace/**', (topic, payload) => { seen.push({ topic, payload: payload as TraceEvent }) })

    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    publishTrace(
      events,
      { traceId: 't1', projectId: 'p1', phase: 'request.preprocess', correlationId: 'c1' },
      { panel: 'request', message: 'pii:scrubbed', details: { entities: ['EMAIL'] } },
    )
    vi.restoreAllMocks()

    expect(seen).toHaveLength(1)
    expect(seen[0]!.topic).toBe('trace/request.preprocess/pii/scrubbed')
    expect(seen[0]!.payload).toEqual({
      traceId: 't1',
      projectId: 'p1',
      correlationId: 'c1',
      entry: {
        panel: 'request',
        message: 'pii:scrubbed',
        details: { entities: ['EMAIL'] },
        module: 'pii',
        phase: 'request.preprocess',
        at: 1_700_000_000_000,
      },
    })
  })

  it('omits phase, project and correlation when the origin has none', () => {
    const events = new EventBus()
    const seen: TraceEvent[] = []
    events.subscribe('trace/**', (_topic, payload) => { seen.push(payload as TraceEvent) })

    publishTrace(events, { traceId: 't2' }, { panel: 'response', message: 'model:error', details: {} })

    expect(seen[0]!.entry.phase).toBeUndefined()
    expect(seen[0]!.projectId).toBeUndefined()
    expect(seen[0]!.correlationId).toBeUndefined()
    expect(seen[0]!.entry.module).toBe('model')
  })

  it('drops prompts and answers unless the project opted in', () => {
    const events = new EventBus()
    const seen: TraceEvent[] = []
    events.subscribe('trace/**', (_topic, payload) => { seen.push(payload as TraceEvent) })
    const entry = {
      panel: 'response' as const,
      message: 'model:success',
      details: { modelId: 'gpt-4o' },
      content: { responseText: 'secret answer' },
    }

    publishTrace(events, { traceId: 't3' }, entry)
    expect(seen[0]!.entry.content).toBeUndefined()
    expect(seen[0]!.entry.details).toEqual({ modelId: 'gpt-4o' })

    publishTrace(events, { traceId: 't4', captureContent: true }, entry)
    expect(seen[1]!.entry.content).toEqual({ responseText: 'secret answer' })
  })
})
