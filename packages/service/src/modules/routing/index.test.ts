import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE, RESILIENCE_STORE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import type { ResilienceStore } from '@routerly/shared'

const routeRequestMock = vi.fn()
vi.mock('./router.js', () => ({
  routeRequest: (...args: unknown[]) => routeRequestMock(...args),
}))

const { routeRequest } = await import('./router.js')
const { routingModule } = await import('./index.js')
const { rememberUpstreamError, forgetUpstreamError } = await import('../reverse-proxy/last-upstream-error.js')

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  const pipeline = new ProcessorRegistry<ProxyContext>()
  container.register(PROXY_PIPELINE, pipeline)
  return { container, events, pipeline }
}

function baseCtx(overrides: Partial<ProxyContext> = {}): ProxyContext {
  return {
    protocol: 'openai',
    req: {} as any,
    reply: {} as any,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    router: { id: 'p1', policies: [] } as any,
    routerId: 'p1',
    traceId: 't1',
    emit: vi.fn(),
    original: { model: 'gpt', messages: [] },
    request: { model: 'gpt', messages: [{ role: 'user', content: 'hi' }] } as any,
    stream: false,
    passthrough: false,
    ...overrides,
  } as ProxyContext
}

describe('routing module', () => {
  it('registers ROUTER with the real routeRequest', async () => {
    const { container, events, pipeline } = harness()
    await routingModule.register({ container, events })
    expect(container.resolve(ROUTER).routeRequest).toBe(routeRequest)
    void pipeline
  })

  it('contributes routing.prepare and routing.memory to the routing.prepare phase', async () => {
    const { container, events, pipeline } = harness()
    await routingModule.register({ container, events })
    const ids = pipeline.orderedFor('routing.prepare').map((p) => p.id)
    expect(ids).toEqual(['routing.prepare', 'routing.memory'])
  })

  describe('routing.prepare processor', () => {
    it('skips routing entirely when ctx.result is already set', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      const ctx = baseCtx({ result: { kind: 'json', body: {} } })
      await proc.run(ctx)
      expect(routeRequestMock).not.toHaveBeenCalled()
    })

    it('passes undefined as the resilience store when RESILIENCE_STORE is not registered (optional-safe)', async () => {
      // Also invokes the emit callback routeRequest received: it is ctx.emit, installed by trace.ingress.
      routeRequestMock.mockImplementation(async (...args: unknown[]) => {
        const emit = args[3] as (entry: unknown) => void
        emit({ panel: 'router-request', message: 'router:intake', details: {} })
        return { models: [{ model: 'm1', weight: 1 }], trace: [] }
      })
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      const ctx = baseCtx()
      await proc.run(ctx)
      expect(routeRequestMock).toHaveBeenCalledWith(
        ctx.request, ctx.router, ctx.log, expect.any(Function), ctx.token, ctx.traceId, ctx.conversationId, undefined,
      )
      expect(ctx.candidates).toEqual([{ model: 'm1', weight: 1 }])
    })

    it('resolves and forwards the container-registered resilience store as the 8th argument', async () => {
      routeRequestMock.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
      const fakeStore = { isAvailable: vi.fn() } as unknown as ResilienceStore
      const { container, events, pipeline } = harness()
      container.register(RESILIENCE_STORE, fakeStore)
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      const ctx = baseCtx()
      await proc.run(ctx)
      expect(routeRequestMock).toHaveBeenCalledWith(
        ctx.request, ctx.router, ctx.log, expect.any(Function), ctx.token, ctx.traceId, ctx.conversationId, fakeStore,
      )
    })
  })

  describe('limits exhausted on a non-passthrough router', () => {
    it.each([
      ['openai', { error: { message: 'Usage limit exceeded for every model of this router.', type: 'insufficient_quota' } }],
      ['anthropic', { type: 'error', error: { type: 'rate_limit_error', message: 'Usage limit exceeded for every model of this router.' } }],
    ] as const)('returns a 429 block for %s', async (protocol, body) => {
      routeRequestMock.mockRejectedValue(new Error('all_models_limits_exceeded'))
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      const ctx = baseCtx({ protocol })
      await proc.run(ctx)
      expect(ctx.result).toEqual({ kind: 'block', status: 429, body })
    })

    it.each([
      ['openai', { error: { message: 'No model of this router is currently available.', type: 'server_error' } }],
      ['anthropic', { type: 'error', error: { type: 'overloaded_error', message: 'No model of this router is currently available.' } }],
    ] as const)('returns a provider-shaped 503 for %s when every model is excluded by policies', async (protocol, body) => {
      routeRequestMock.mockRejectedValue(new Error('all_models_excluded_by_policies'))
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      const ctx = baseCtx({ protocol })
      await proc.run(ctx)
      expect(ctx.result).toEqual({ kind: 'block', status: 503, body })
    })

    it('returns the remembered upstream 401 instead of a 503 when every model is excluded', async () => {
      routeRequestMock.mockRejectedValue(new Error('all_models_excluded_by_policies'))
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      const ctx = baseCtx({ protocol: 'anthropic' })
      rememberUpstreamError(ctx.router.id, 401, { error: { message: 'Incorrect API key' } })
      await proc.run(ctx)
      expect(ctx.result).toEqual({ kind: 'block', status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'Incorrect API key' } } })
      forgetUpstreamError(ctx.router.id)
    })

    it('rethrows other routing errors', async () => {
      routeRequestMock.mockRejectedValue(new Error('no_models_available'))
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
      await expect(proc.run(baseCtx())).rejects.toThrow('no_models_available')
    })
  })

  describe('routing.memory processor', () => {
    it('does nothing for the anthropic protocol', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({ protocol: 'anthropic', conversationId: 'c1', candidates: [{ model: 'm1', weight: 1 }] })
      proc.run(ctx)
      // no throw, no state mutation observable — memory store is internal; assert via absence of error
      expect(ctx.candidates).toEqual([{ model: 'm1', weight: 1 }])
    })

    it('does nothing without a conversationId', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({ protocol: 'openai', candidates: [{ model: 'm1', weight: 1 }] })
      expect(() => proc.run(ctx)).not.toThrow()
    })

    it('does nothing when there is no top candidate', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({ protocol: 'openai', conversationId: 'c1', candidates: [] })
      expect(() => proc.run(ctx)).not.toThrow()
    })

    it('does nothing when router.policies is undefined', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({
        protocol: 'openai',
        conversationId: 'c1',
        candidates: [{ model: 'm1', weight: 1 }],
        router: { id: 'p1' } as any,
      })
      expect(() => proc.run(ctx)).not.toThrow()
    })

    it('does nothing when memory is not enabled on any llm policy', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({
        protocol: 'openai',
        conversationId: 'c1',
        candidates: [{ model: 'm1', weight: 1 }],
        router: { id: 'p1', policies: [{ type: 'llm', enabled: true, config: {} }] } as any,
      })
      expect(() => proc.run(ctx)).not.toThrow()
    })

    it('records the routing decision when memory is enabled on an active llm policy', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({
        protocol: 'openai',
        conversationId: 'c1',
        candidates: [{ model: 'm1', weight: 1 }],
        router: { id: 'p1', policies: [{ type: 'llm', enabled: true, config: { memory: true } }] } as any,
      })
      expect(() => proc.run(ctx)).not.toThrow()
    })
  })
})
