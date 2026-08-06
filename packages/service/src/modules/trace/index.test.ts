import { describe, it, expect, beforeEach } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { getTrace, getTraceCorrelationId, resetTraceStore } from './store.js'
import { traceModule, correlationIdFrom } from './index.js'
import { TRACE_COMPLETED_TOPIC, type TraceCompletedEvent } from './publish.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('trace module', () => {
  beforeEach(() => {
    resetTraceStore()
  })

  it('contributes ingress + finalize trace processors', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('ingress').map((p) => p.id)).toContain('trace.ingress')
    expect(pipeline.orderedFor('finalize').map((p) => p.id)).toContain('trace.finalize')
  })

  it('trace.ingress opens the buffer and installs emit', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'trace.ingress')!
    const ctx = {
      traceId: 'trace-test-1',
      projectId: 'p1',
      req: { headers: { 'x-routerly-trace': 'c1' } },
    } as unknown as ProxyContext
    await ingress.run(ctx)
    expect(getTrace('trace-test-1')).toEqual([])
    expect(ctx.correlationId).toBe('c1')
    expect(getTraceCorrelationId('trace-test-1')).toBe('c1')
    expect(typeof ctx.emit).toBe('function')
  })

  it('correlationIdFrom ignores the legacy opt-in and anything unusable', () => {
    expect(correlationIdFrom({ 'x-routerly-trace': 'abc' })).toBe('abc')
    expect(correlationIdFrom({ 'x-routerly-trace': '  abc  ' })).toBe('abc')
    expect(correlationIdFrom({ 'x-routerly-trace': '1' })).toBeUndefined()
    expect(correlationIdFrom({ 'x-routerly-trace': '' })).toBeUndefined()
    expect(correlationIdFrom({ 'x-routerly-trace': ['a', 'b'] })).toBeUndefined()
    expect(correlationIdFrom({})).toBeUndefined()
    expect(correlationIdFrom({ 'x-routerly-trace': 'x'.repeat(200) })).toHaveLength(128)
  })

  it('what a phase emits travels the bus and lands in the buffer', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'trace.ingress')!
    const ctx = { traceId: 'trace-test-2', projectId: 'p1', phase: 'ingress' } as unknown as ProxyContext
    await ingress.run(ctx)

    ctx.phase = 'request.preprocess'
    ctx.emit!({ panel: 'request', message: 'pii:scrubbed', details: { entities: ['EMAIL'] } })

    const trace = getTrace('trace-test-2')!
    expect(trace).toHaveLength(1)
    expect(trace[0]!.phase).toBe('request.preprocess')
    expect(trace[0]!.module).toBe('pii')
  })

  it('trace.finalize exports the stamped buffer, and nothing for an unopened trace', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'trace.ingress')!
    const finalize = pipeline.orderedFor('finalize').find((p) => p.id === 'trace.finalize')!

    const completed: TraceCompletedEvent[] = []
    events.subscribe(TRACE_COMPLETED_TOPIC, (_t, payload) => { completed.push(payload as TraceCompletedEvent) })

    const ctx = { traceId: 'trace-test-3', projectId: 'p1' } as unknown as ProxyContext
    await ingress.run(ctx)
    ctx.phase = 'routing.prepare'
    ctx.emit!({ panel: 'response', message: 'router:result', details: {} })
    await finalize.run(ctx)

    // Exporters group by phase and module: a copy taken before publishTrace stamped
    // the entries would flatten the whole request into one anonymous bucket.
    expect(completed[0]!.entries).toHaveLength(2) // the emitted entry + the recap
    expect(completed[0]!.entries[0]!.phase).toBe('routing.prepare')
    expect(completed[0]!.entries[0]!.module).toBe('router')

    await finalize.run({ traceId: 'trace-test-4' } as unknown as ProxyContext)
    expect(completed).toHaveLength(1)
  })

  it('trace.finalize announces the finished trace once, off the trace/** subtree', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'trace.ingress')!
    const finalize = pipeline.orderedFor('finalize').find((p) => p.id === 'trace.finalize')!

    const completed: TraceCompletedEvent[] = []
    events.subscribe(TRACE_COMPLETED_TOPIC, (_t, payload) => { completed.push(payload as TraceCompletedEvent) })
    const recorded: unknown[] = []
    events.subscribe('trace/**', (_t, payload) => { recorded.push(payload) })

    const ctx = {
      traceId: 'trace-test-5',
      projectId: 'p1',
      req: { headers: { 'x-routerly-trace': 'c9' } },
    } as unknown as ProxyContext
    await ingress.run(ctx)
    ctx.emit!({ panel: 'response', message: 'model:success', details: {} })
    await finalize.run(ctx)

    expect(completed).toHaveLength(1)
    expect(completed[0]!.traceId).toBe('trace-test-5')
    expect(completed[0]!.projectId).toBe('p1')
    expect(completed[0]!.correlationId).toBe('c9')
    expect(completed[0]!.entries).toHaveLength(2)
    // The completion event must never be mistaken for one more entry.
    expect(recorded).toHaveLength(2)
  })

  it('trace.finalize closes the trace with a recap of the request', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'trace.ingress')!
    const finalize = pipeline.orderedFor('finalize').find((p) => p.id === 'trace.finalize')!

    const ctx = { traceId: 'trace-test-7', projectId: 'p1' } as unknown as ProxyContext
    await ingress.run(ctx)
    ctx.phase = 'upstream.execute'
    ctx.emit!({ panel: 'request', message: 'model:request', details: { modelId: 'gpt-4o', provider: 'openai' } })
    ctx.emit!({
      panel: 'response',
      message: 'model:success',
      details: { modelId: 'gpt-4o', inputTokens: 10, outputTokens: 4, totalCostUsd: 0.002, latencyMs: 120 },
    })
    ctx.phase = 'finalize' // the driver stamps the phase before running it
    await finalize.run(ctx)

    const trace = getTrace('trace-test-7')!
    const recap = trace[trace.length - 1]!
    expect(recap.message).toBe('trace:recap')
    expect(recap.module).toBe('trace')
    expect(recap.phase).toBe('finalize')
    expect(recap.details).toMatchObject({
      outcome: 'ok',
      model: 'gpt-4o',
      provider: 'openai',
      attempts: 1,
      tokens: { input: 10, output: 4 },
      costUsd: 0.002,
    })
    expect(recap.details.durationMs).toBeTypeOf('number')
  })

  it('trace.finalize stays quiet on an empty trace', async () => {
    const { container, events } = harness()
    await traceModule.register({ container, events })
    const finalize = container.resolve(PROXY_PIPELINE).orderedFor('finalize').find((p) => p.id === 'trace.finalize')!

    const completed: unknown[] = []
    events.subscribe(TRACE_COMPLETED_TOPIC, (_t, payload) => { completed.push(payload) })

    await finalize.run({ traceId: 'trace-test-6' } as unknown as ProxyContext)

    expect(completed).toHaveLength(0)
  })
})
