import { describe, it, expect, vi, afterEach } from 'vitest'
import { PASSTHROUGH_MODEL_ID } from '@routerly/shared'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'

const routeRequestMock = vi.fn()
vi.mock('./router.js', () => ({
  routeRequest: (...args: unknown[]) => routeRequestMock(...args),
}))

const forwardPassthroughRawMock = vi.fn()
vi.mock('../api-reverse-proxy/router-passthrough.js', () => ({
  forwardPassthroughRaw: (...args: unknown[]) => forwardPassthroughRawMock(...args),
}))

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
    req: { url: '/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer sk-rt-x' } } as any,
    reply: {} as any,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    router: { id: 'pt1', kind: 'passthrough', models: [], policies: [] } as any,
    routerId: 'pt1',
    traceId: 't1',
    emit: vi.fn(),
    original: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    request: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] } as any,
    stream: false,
    passthrough: false,
    ...overrides,
  } as ProxyContext
}

async function getPrepareProcessor() {
  const { container, events, pipeline } = harness()
  await routingModule.register({ container, events })
  return pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
}

afterEach(() => { vi.clearAllMocks() })

describe('routing.prepare — passthrough branch (PR-E, AC9/AC10)', () => {
  it('sentinel at index 0: never calls routeRequest, forwards raw and blocks the pipeline', async () => {
    const proc = await getPrepareProcessor()
    const ctx = baseCtx({
      router: {
        id: 'pt1', kind: 'passthrough', policies: [],
        models: [{ modelId: PASSTHROUGH_MODEL_ID }, { modelId: 'gpt-4o' }],
      } as any,
    })

    await proc.run(ctx)

    expect(routeRequestMock).not.toHaveBeenCalled()
    expect(forwardPassthroughRawMock).toHaveBeenCalledTimes(1)
    const [router, path, method, headers, body, reply, log] = forwardPassthroughRawMock.mock.calls[0]!
    expect(router).toBe(ctx.router)
    expect(path).toBe('/v1/chat/completions')
    expect(method).toBe('POST')
    expect(headers).toBe(ctx.req.headers)
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(JSON.parse((body as Buffer).toString('utf8'))).toEqual(ctx.original)
    expect(reply).toBe(ctx.reply)
    expect(log).toBe(ctx.log)

    expect(ctx.result).toEqual({ kind: 'block' })
    expect(ctx.blockedBy).toBeUndefined()
  })

  it('sentinel elsewhere in the list: routes normally when routeRequest succeeds', async () => {
    routeRequestMock.mockResolvedValue({ models: [{ model: 'gpt-4o', weight: 1 }], trace: [] })
    const proc = await getPrepareProcessor()
    const ctx = baseCtx({
      router: {
        id: 'pt1', kind: 'passthrough', policies: [],
        models: [{ modelId: 'gpt-4o' }, { modelId: PASSTHROUGH_MODEL_ID }],
      } as any,
    })

    await proc.run(ctx)

    expect(routeRequestMock).toHaveBeenCalledTimes(1)
    expect(forwardPassthroughRawMock).not.toHaveBeenCalled()
    expect(ctx.candidates).toEqual([{ model: 'gpt-4o', weight: 1 }])
    expect(ctx.result).toBeUndefined()
  })

  it.each([
    'no_models_available: router has no resolvable models',
    'all_models_limits_exceeded',
    'all_models_excluded_by_policies',
  ])('falls back to raw-forward instead of a 5xx when routeRequest throws %s', async (message) => {
    routeRequestMock.mockRejectedValue(new Error(message))
    const proc = await getPrepareProcessor()
    const ctx = baseCtx({
      router: {
        id: 'pt1', kind: 'passthrough', policies: [],
        models: [{ modelId: 'gpt-4o' }, { modelId: PASSTHROUGH_MODEL_ID }],
      } as any,
    })

    await expect(proc.run(ctx)).resolves.toBeUndefined()

    expect(forwardPassthroughRawMock).toHaveBeenCalledTimes(1)
    expect(ctx.result).toEqual({ kind: 'block' })
    expect(ctx.blockedBy).toBeUndefined()
  })

  it('rethrows an unrelated routeRequest error instead of falling back', async () => {
    routeRequestMock.mockRejectedValue(new Error('provider_unreachable'))
    const proc = await getPrepareProcessor()
    const ctx = baseCtx({
      router: {
        id: 'pt1', kind: 'passthrough', policies: [],
        models: [{ modelId: 'gpt-4o' }, { modelId: PASSTHROUGH_MODEL_ID }],
      } as any,
    })

    await expect(proc.run(ctx)).rejects.toThrow('provider_unreachable')
    expect(forwardPassthroughRawMock).not.toHaveBeenCalled()
  })
})
