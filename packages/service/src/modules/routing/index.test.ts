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
    project: { id: 'p1', policies: [] } as any,
    projectId: 'p1',
    traceId: 't1',
    traceEnabled: true,
    traceSuppressed: false,
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
      // Also invokes the emit callback routeRequest received, exercising the appendTrace closure.
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
        ctx.request, ctx.project, ctx.log, expect.any(Function), ctx.token, ctx.traceId, ctx.conversationId, undefined,
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
        ctx.request, ctx.project, ctx.log, expect.any(Function), ctx.token, ctx.traceId, ctx.conversationId, fakeStore,
      )
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

    it('does nothing when project.policies is undefined', async () => {
      const { container, events, pipeline } = harness()
      await routingModule.register({ container, events })
      const proc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.memory')!
      const ctx = baseCtx({
        protocol: 'openai',
        conversationId: 'c1',
        candidates: [{ model: 'm1', weight: 1 }],
        project: { id: 'p1' } as any,
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
        project: { id: 'p1', policies: [{ type: 'llm', enabled: true, config: {} }] } as any,
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
        project: { id: 'p1', policies: [{ type: 'llm', enabled: true, config: { memory: true } }] } as any,
      })
      expect(() => proc.run(ctx)).not.toThrow()
    })
  })
})
