import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProxyContext } from '../context.js'

// A moderation refusal returned as a non-2xx error: setting off stops with the original error,
// setting on moves to another provider (ROUT-630).
const runPhase = vi.fn()
const logAudit = vi.fn(async () => {})
vi.mock('../run.js', () => ({ getProxyPipeline: () => ({ runPhase }) }))
vi.mock('../../audit/logger.js', () => ({ logAudit }))
vi.mock('../../notifications/emitter.js', () => ({ emitEvent: vi.fn(async () => {}) }))
vi.mock('../../provider/list-effective.js', () => ({
  listEffectiveModels: async () => [
    { id: 'a1', provider: 'azure' }, { id: 'a2', provider: 'azure' },
    { id: 'b1', provider: 'openai' }, { id: 'c1', provider: 'mistral' }, { id: 'd1', provider: 'google' },
  ],
}))

const { openaiAttempt } = await import('./openai.js')
const { anthropicAttempt } = await import('./anthropic.js')
const { forgetUpstreamError } = await import('../last-upstream-error.js')
const { resetModerationMemory, MAX_MODERATION_SUBSTITUTES } = await import('../moderation-fallback.js')

const REFUSAL = { status: 400, body: { error: { code: 'content_filter', message: 'filtered by policy' } } }

function ctxFor(protocol: 'openai' | 'anthropic', moderationFallback: boolean | undefined, models: string[], answering: string[], calls: string[]): ProxyContext {
  const ctx = {
    protocol,
    router: { id: 'r-m', kind: 'router', ...(moderationFallback !== undefined ? { moderationFallback } : {}) },
    candidates: models.map((model) => ({ model, weight: 1 })),
    request: { model: 'r-m' },
    log: { info: vi.fn(), warn: vi.fn() },
    emit: vi.fn(),
  } as unknown as ProxyContext
  runPhase.mockImplementation(async (phase: string) => {
    if (phase !== 'upstream.execute') return
    const id = ctx.attempt!.model.id
    calls.push(id)
    if (answering.includes(id)) ctx.result = { kind: 'json', status: 200, body: { id: 'ok' } } as never
    else { ctx.attemptError = new Error('refused'); ctx.attemptResponse = REFUSAL }
  })
  return ctx
}

beforeEach(() => { resetModerationMemory(); logAudit.mockClear(); forgetUpstreamError('r-m') })

describe.each([['openai', openaiAttempt], ['anthropic', anthropicAttempt]] as const)('%s lane moderation fallback', (protocol, lane) => {
  it('setting off: stops at the first refusal and returns the original error', async () => {
    const calls: string[] = []
    const ctx = ctxFor(protocol, undefined, ['a1', 'b1'], ['b1'], calls)
    await lane.run(ctx)
    expect(calls).toEqual(['a1'])
    expect(ctx.result).toMatchObject({ kind: 'block', status: 400 })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('setting on: skips same-provider models and answers from another provider', async () => {
    const calls: string[] = []
    const ctx = ctxFor(protocol, true, ['a1', 'a2', 'b1'], ['b1'], calls)
    await lane.run(ctx)
    expect(calls).toEqual(['a1', 'b1'])
    expect(ctx.result).toMatchObject({ kind: 'json', status: 200 })
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'proxy:moderation_fallback', result: 'success', details: expect.objectContaining({ from: 'a1', to: 'b1' }) }))
  })

  it('setting on: at most two substitutes, then the FIRST refusal is returned', async () => {
    const calls: string[] = []
    const ctx = ctxFor(protocol, true, ['a1', 'b1', 'c1', 'd1'], [], calls)
    await lane.run(ctx)
    expect(calls).toEqual(['a1', 'b1', 'c1'])
    expect(calls.length).toBe(1 + MAX_MODERATION_SUBSTITUTES)
    expect(ctx.result).toMatchObject({ kind: 'block', status: 400 })
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ result: 'error', details: expect.objectContaining({ from: 'a1', to: null }) }))
  })

  it('setting on: a model that refused recently is not used as a substitute', async () => {
    await lane.run(ctxFor(protocol, true, ['a1', 'b1'], [], []))
    const calls: string[] = []
    const ctx = ctxFor(protocol, true, ['c1', 'b1', 'd1'], ['d1'], calls)
    await lane.run(ctx)
    expect(calls).toEqual(['c1', 'd1'])
  })

  it('a non-moderation error is never treated as a refusal', async () => {
    const calls: string[] = []
    const ctx = ctxFor(protocol, undefined, ['a1', 'b1'], ['b1'], calls)
    runPhase.mockImplementation(async (phase: string) => {
      if (phase !== 'upstream.execute') return
      calls.push(ctx.attempt!.model.id)
      if (ctx.attempt!.model.id === 'b1') ctx.result = { kind: 'json', status: 200, body: {} } as never
      else { ctx.attemptError = new Error('x'); ctx.attemptResponse = { status: 429, body: { error: { message: 'slow down' } } } }
    })
    await lane.run(ctx)
    expect(calls).toEqual(['a1', 'b1'])
  })
})
