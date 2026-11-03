import { describe, it, expect, vi } from 'vitest'
import type { ProxyContext } from '../context.js'

// Every candidate fails upstream: the client must get the provider's deterministic 4xx
// (invalid key -> 401), shaped for its own protocol, not a generic 503 (ROUT-287).
const runPhase = vi.fn()
vi.mock('../run.js', () => ({ getProxyPipeline: () => ({ runPhase }) }))
vi.mock('../../provider/list-effective.js', () => ({ listEffectiveModels: async () => [{ id: 'm1' }] }))
vi.mock('../../notifications/emitter.js', () => ({ emitEvent: vi.fn(async () => {}) }))

const { openaiAttempt } = await import('./openai.js')
const { anthropicAttempt } = await import('./anthropic.js')
const { recallUpstreamError, forgetUpstreamError } = await import('../last-upstream-error.js')

function ctxFor(protocol: 'openai' | 'anthropic', status: number, body: unknown): ProxyContext {
  const ctx = {
    protocol,
    router: { id: 'r-x', kind: 'router' },
    candidates: [{ model: 'm1', weight: 1 }],
    request: { model: 'r-x' },
    log: { info: vi.fn(), warn: vi.fn() },
  } as unknown as ProxyContext
  runPhase.mockImplementation(async (phase: string) => {
    if (phase === 'upstream.execute') { ctx.attemptError = new Error('x'); ctx.attemptResponse = { status, body } }
  })
  return ctx
}

describe('attempt loops when every candidate fails upstream', () => {
  const anthropicBody = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }

  it('openai lane returns the upstream 401 in OpenAI shape and remembers it', async () => {
    const ctx = ctxFor('openai', 401, anthropicBody)
    await openaiAttempt.run(ctx)
    expect(ctx.result).toMatchObject({ kind: 'block', status: 401, body: { error: { message: 'invalid x-api-key' } } })
    expect(recallUpstreamError('r-x')?.status).toBe(401)
    forgetUpstreamError('r-x')
  })

  it('anthropic lane returns the upstream 401 in Anthropic shape', async () => {
    const ctx = ctxFor('anthropic', 401, { error: { message: 'Incorrect API key' } })
    await anthropicAttempt.run(ctx)
    expect(ctx.result).toEqual({ kind: 'block', status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'Incorrect API key' } } })
    forgetUpstreamError('r-x')
  })

  it.each(['openai', 'anthropic'] as const)('%s lane keeps a generic 503 for upstream 5xx', async (protocol) => {
    const ctx = ctxFor(protocol, 500, { error: { message: 'boom' } })
    await (protocol === 'openai' ? openaiAttempt : anthropicAttempt).run(ctx)
    expect(ctx.result).toMatchObject({ kind: 'block', status: 503 })
  })
})
