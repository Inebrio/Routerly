import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FallbackStrategyType } from '@routerly/shared'
import type { ProxyContext } from '../context.js'

// The profile fallback strategy drives the retry loop of both plain-Router lanes (ROUT-682).
const runPhase = vi.fn()
vi.mock('../run.js', () => ({ getProxyPipeline: () => ({ runPhase }) }))
vi.mock('../../provider/list-effective.js', () => ({ listEffectiveModels: async () => [{ id: 'm1' }, { id: 'm2' }] }))
vi.mock('../../notifications/emitter.js', () => ({ emitEvent: vi.fn(async () => {}) }))

const { openaiAttempt } = await import('./openai.js')
const { anthropicAttempt } = await import('./anthropic.js')

type Behaviour = Record<string, number[]> // model -> upstream status per call (0 = success)

function setup(protocol: 'openai' | 'anthropic', strategy: FallbackStrategyType | undefined, behaviour: Behaviour) {
  const calls: string[] = []
  const emit = vi.fn()
  const ctx = {
    protocol,
    router: { id: 'r-x', kind: 'router' },
    candidates: [{ model: 'm1', weight: 2 }, { model: 'm2', weight: 1 }],
    request: { model: 'r-x' },
    ...(strategy ? { fallbackStrategy: strategy } : {}),
    emit,
    log: { info: vi.fn(), warn: vi.fn() },
  } as unknown as ProxyContext
  runPhase.mockImplementation(async (phase: string) => {
    if (phase !== 'upstream.execute') return
    const id = ctx.attempt!.model.id
    calls.push(id)
    const status = (behaviour[id] ?? [500]).shift() ?? 500
    if (status === 0) ctx.result = { kind: 'block', status: 200, body: {} }
    else { ctx.attemptError = new Error('x'); ctx.attemptResponse = { status, body: {} } }
  })
  return { ctx, calls, emit }
}

async function run(protocol: 'openai' | 'anthropic', ctx: ProxyContext) {
  const p = (protocol === 'openai' ? openaiAttempt : anthropicAttempt).run(ctx)
  await vi.runAllTimersAsync()
  await p
}

describe.each(['openai', 'anthropic'] as const)('%s lane honours the profile fallback strategy', (protocol) => {
  beforeEach(() => { vi.useFakeTimers(); runPhase.mockReset() })
  afterEach(() => vi.useRealTimers())

  it('next-best (and unset) goes to the next model', async () => {
    for (const strategy of ['next-best', undefined] as const) {
      const { ctx, calls } = setup(protocol, strategy, { m1: [500], m2: [0] })
      await run(protocol, ctx)
      expect(calls).toEqual(['m1', 'm2'])
    }
  })

  it('abort stops at the first failure', async () => {
    const { ctx, calls, emit } = setup(protocol, 'abort', { m1: [500], m2: [0] })
    await run(protocol, ctx)
    expect(calls).toEqual(['m1'])
    expect(ctx.result).toMatchObject({ kind: 'block', status: 503 })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ message: 'router:fallback', details: expect.objectContaining({ strategy: 'abort', action: 'abort' }) }))
  })

  it('retry-after-cooldown retries the same model before moving on', async () => {
    const { ctx, calls } = setup(protocol, 'retry-after-cooldown', { m1: [500, 0], m2: [0] })
    await run(protocol, ctx)
    expect(calls).toEqual(['m1', 'm1'])
    expect(ctx.result).toMatchObject({ status: 200 })
  })

  it('retry-after-cooldown does not retry a deterministic 4xx', async () => {
    const { ctx, calls } = setup(protocol, 'retry-after-cooldown', { m1: [401], m2: [0] })
    await run(protocol, ctx)
    expect(calls).toEqual(['m1', 'm2'])
  })
})
