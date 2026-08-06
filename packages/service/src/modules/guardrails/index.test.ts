// packages/service/src/modules/guardrails.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { BudgetExceededError } from '../reverse-proxy/execute.js'

const checkGuardrailsMock = vi.fn()
const injectionMock = vi.fn<() => string | null>(() => null)
vi.mock('./guardrails.js', () => ({
  checkGuardrails: (...args: unknown[]) => checkGuardrailsMock(...args),
  buildRequestInjection: () => injectionMock(),
  injectingRules: () => [{ index: 2, rule: 'topic:judge' }],
}))

const { guardrailsModule } = await import('./index.js')

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

function fakeReply() {
  const writes: string[] = []
  return {
    header: vi.fn(),
    hijack: vi.fn(),
    raw: {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => { writes.push(chunk) }),
      end: vi.fn(),
    },
    _writes: writes,
  }
}

function baseCtx(overrides: Partial<ProxyContext> = {}): ProxyContext {
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: fakeReply() as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    router: { id: 'p1', guardrails: { rules: [] } } as any,
    routerId: 'p1',
    traceId: 't1',
    original: { model: 'gpt', messages: [] },
    request: { model: 'gpt', messages: [{ role: 'user', content: 'hi' }] } as any,
    stream: false,
    passthrough: false,
    ...overrides,
  } as ProxyContext
}

async function requestProcessor() {
  const { container, events } = harness()
  await guardrailsModule.register({ container, events })
  const pipeline = container.resolve(PROXY_PIPELINE)
  return pipeline.orderedFor('request.preprocess').find((p) => p.id === 'guardrail.request')!
}

async function responseProcessor() {
  const { container, events } = harness()
  await guardrailsModule.register({ container, events })
  const pipeline = container.resolve(PROXY_PIPELINE)
  return pipeline.orderedFor('response.postprocess').find((p) => p.id === 'guardrail.response')!
}

describe('guardrails module', () => {
  it('contributes request + response guardrail processors', async () => {
    const { container, events } = harness()
    await guardrailsModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('request.preprocess').map((p) => p.id)).toContain('guardrail.request')
    expect(pipeline.orderedFor('response.postprocess').map((p) => p.id)).toContain('guardrail.response')
  })

  it('hard-blocks a non-streaming request without touching the response headers', async () => {
    checkGuardrailsMock.mockResolvedValue({ evaluated: [], triggered: 'rule1', block: true, log: false })
    const proc = await requestProcessor()
    const ctx = baseCtx({ stream: false })
    await proc.run(ctx)
    expect((ctx.reply as any).header).not.toHaveBeenCalled()
    expect(ctx.result?.kind).toBe('block')
    expect(ctx.result?.body).toBeDefined()
  })

  it('converts a BudgetExceededError from the guardrail judge into an OpenAI 429 block', async () => {
    checkGuardrailsMock.mockRejectedValue(new BudgetExceededError('over'))
    const proc = await requestProcessor()
    const ctx = baseCtx({ protocol: 'openai' })
    await proc.run(ctx)
    expect((ctx.reply as any).header).not.toHaveBeenCalled()
    expect(ctx.result).toEqual({
      kind: 'block', status: 429,
      body: { error: { message: 'Usage limit exceeded by content-guardrail check.', type: 'insufficient_quota' } },
    })
  })

  it('converts a BudgetExceededError from the guardrail judge into an Anthropic 429 block', async () => {
    checkGuardrailsMock.mockRejectedValue(new BudgetExceededError('over'))
    const proc = await requestProcessor()
    const ctx = baseCtx({ protocol: 'anthropic' })
    await proc.run(ctx)
    expect((ctx.reply as any).header).not.toHaveBeenCalled()
    expect(ctx.result).toEqual({
      kind: 'block', status: 429,
      body: { type: 'error', error: { type: 'rate_limit_error', message: 'Usage limit exceeded by content-guardrail check.' } },
    })
  })

  it('rethrows non-budget errors from the guardrail judge unchanged', async () => {
    checkGuardrailsMock.mockRejectedValue(new Error('boom'))
    const proc = await requestProcessor()
    const ctx = baseCtx()
    await expect(proc.run(ctx)).rejects.toThrow('boom')
  })

  it('hard-blocks a streaming OpenAI request via SSE hijack, not JSON', async () => {
    checkGuardrailsMock.mockResolvedValue({ evaluated: [], triggered: 'rule1', block: true, log: false })
    const proc = await requestProcessor()
    const ctx = baseCtx({ stream: true, protocol: 'openai' })
    await proc.run(ctx)
    expect((ctx.reply as any).hijack).toHaveBeenCalled()
    const writes = (ctx.reply as any)._writes as string[]
    expect(writes.some((w) => w.includes('"finish_reason":"content_filter"'))).toBe(true)
    expect(writes[writes.length - 1]).toBe('data: [DONE]\n\n')
    expect(ctx.result).toEqual({ kind: 'block' })
  })

  it('traces the steering injection, with the injected text under the content opt-in', async () => {
    checkGuardrailsMock.mockResolvedValue({ evaluated: [], triggered: undefined })
    injectionMock.mockReturnValueOnce('Stay on topic.')
    const proc = await requestProcessor()
    const emit = vi.fn()
    const ctx = baseCtx({ emit })
    await proc.run(ctx)
    expect(ctx.requestInjection).toBe('Stay on topic.')
    expect(emit).toHaveBeenCalledWith({
      panel: 'request',
      message: 'guardrail:injected',
      details: { target: 'request', rules: [{ index: 2, rule: 'topic:judge' }], chars: 14 },
      content: { injection: 'Stay on topic.' },
    })
  })

  it('emits nothing when there is no injection to apply', async () => {
    checkGuardrailsMock.mockResolvedValue({ evaluated: [], triggered: undefined })
    const proc = await requestProcessor()
    const emit = vi.fn()
    await proc.run(baseCtx({ emit }))
    expect(emit).not.toHaveBeenCalled()
  })

  it('hard-blocks a non-streaming response without touching the response headers (OpenAI only)', async () => {
    checkGuardrailsMock.mockResolvedValue({ evaluated: [], triggered: 'rule1', block: true, log: false })
    const proc = await responseProcessor()
    const ctx = baseCtx({
      protocol: 'openai',
      result: { kind: 'json', body: { choices: [{ message: { content: 'bad text' } }] } } as any,
    })
    await proc.run(ctx)
    expect((ctx.reply as any).header).not.toHaveBeenCalled()
    expect(ctx.result?.kind).toBe('block')
  })
})
