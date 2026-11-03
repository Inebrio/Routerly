import { describe, expect, it, vi } from 'vitest'
import {
  OPTIMIZER_FIXTURES,
  optimizerFixture,
  type ChatCompletionRequest,
  type Message,
  type OptimizerStep,
} from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { segment, tokensOf } from './messages.js'
import { sessionDedupOptimizer } from './session-dedup/index.js'
import { ccrOptimizer } from './ccr/index.js'
import { rtkOptimizer } from './rtk/index.js'
import { jsonTableOptimizer } from './json-table/index.js'
import { relevanceOptimizer } from './relevance/index.js'
import { cavemanOptimizer } from './caveman/index.js'

// The headroom optimizer sizes its budget on the requested model's context
// window, which it reads from the effective model list. `small-window` stands in
// for the 32k-class local models a real install has.
vi.mock('../provider/list-effective.js', () => ({
  listEffectiveModels: vi.fn(async () => [{ id: 'small-window', contextWindow: 32000 }]),
}))
const { headroomOptimizer, resetContextWindowCache } = await import('./headroom/index.js')

function ctxWith(messages: Message[], model = 'gpt', steps: OptimizerStep[] = []): ProxyContext {
  const request = { model, messages: structuredClone(messages) } as ChatCompletionRequest
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    router: { id: 'p1', optimizers: { steps } } as any,
    routerId: 'p1',
    traceId: 't1',
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as ProxyContext
}

/** Tokens the optimizer actually removed from this fixture. */
function saving(optimizer: { optimize(ctx: ProxyContext): unknown }, ctx: ProxyContext): number {
  const before = tokensOf(ctx.request.messages ?? [])
  optimizer.optimize(ctx)
  return before - tokensOf(ctx.request.messages ?? [])
}

describe('optimizer fixtures', () => {
  it('exposes stable ids the surfaces reference', () => {
    const ids = OPTIMIZER_FIXTURES.map(f => f.id)
    expect(ids).toEqual(['support-chat-en', 'brief-en', 'agent-tools-en', 'long-context-en'])
  })

  it('gives every fixture a non-empty conversation', () => {
    for (const f of OPTIMIZER_FIXTURES) {
      expect(f.messages.length).toBeGreaterThan(0)
      expect(f.label).not.toBe('')
      expect(f.description).not.toBe('')
    }
  })

  // Everything below is the point of the fixtures: a preview that reports
  // "skipped" on every step is what a user sees as an optimizer that does not
  // work. Each assertion runs the real optimizer over the real fixture.

  describe('support-chat-en', () => {
    const fixture = optimizerFixture('support-chat-en')!

    it('repeats one message often enough for session-dedup to drop some', () => {
      const ctx = ctxWith(fixture.messages)
      expect(sessionDedupOptimizer.supports(ctx)).toBe(true)
      expect(saving(sessionDedupOptimizer, ctx)).toBeGreaterThan(0)
    })

    it('runs long enough past the ccr window for condensing to pay off', () => {
      const ctx = ctxWith(fixture.messages)
      expect(segment(fixture.messages).turns.length).toBeGreaterThanOrEqual(6)
      expect(ccrOptimizer.supports(ctx)).toBe(true)
      expect(saving(ccrOptimizer, ctx)).toBeGreaterThan(0)
    })

    it('carries the padded whitespace and duplicated signature rtk strips', () => {
      const ctx = ctxWith(fixture.messages)
      expect(rtkOptimizer.supports(ctx)).toBe(true)
      expect(saving(rtkOptimizer, ctx)).toBeGreaterThan(0)
    })

    it('is English prose caveman can thin out', () => {
      const ctx = ctxWith(fixture.messages)
      expect(cavemanOptimizer.supports(ctx)).toBe(true)
    })

    it('has older turns loose enough for relevance to drop', () => {
      const ctx = ctxWith(fixture.messages, 'gpt', [{ id: 'relevance', enabled: true, threshold: 0.1 }])
      expect(relevanceOptimizer.supports(ctx)).toBe(true)
    })
  })

  describe('agent-tools-en', () => {
    const fixture = optimizerFixture('agent-tools-en')!

    it('carries JSON array tool results json-table compacts', () => {
      const ctx = ctxWith(fixture.messages)
      expect(jsonTableOptimizer.supports(ctx)).toBe(true)
      expect(saving(jsonTableOptimizer, ctx)).toBeGreaterThan(0)
    })

    it('repeats its status line often enough for session-dedup', () => {
      const ctx = ctxWith(fixture.messages)
      expect(sessionDedupOptimizer.supports(ctx)).toBe(true)
      expect(saving(sessionDedupOptimizer, ctx)).toBeGreaterThan(0)
    })

    it('carries a pasted install log rtk compacts', () => {
      const ctx = ctxWith(fixture.messages)
      expect(rtkOptimizer.supports(ctx)).toBe(true)
      expect(saving(rtkOptimizer, ctx)).toBeGreaterThan(0)
    })

    it('runs past the ccr window with long enough older turns', () => {
      const ctx = ctxWith(fixture.messages)
      expect(ccrOptimizer.supports(ctx)).toBe(true)
      expect(saving(ccrOptimizer, ctx)).toBeGreaterThan(0)
    })
  })

  describe('long-context-en', () => {
    const fixture = optimizerFixture('long-context-en')!

    it('overflows a 32k context window, which is what headroom needs to fire', async () => {
      resetContextWindowCache()
      expect(tokensOf(fixture.messages)).toBeGreaterThan(32000)
      // The window cache is filled in the background on first read, so the first
      // call always misses. That is the live behaviour too.
      headroomOptimizer.supports(ctxWith(fixture.messages, 'small-window'))
      await vi.waitFor(() =>
        expect(headroomOptimizer.supports(ctxWith(fixture.messages, 'small-window'))).toBe(true),
      )
      const ctx = ctxWith(fixture.messages, 'small-window')
      expect(saving(headroomOptimizer, ctx)).toBeGreaterThan(0)
      expect(tokensOf(ctx.request.messages ?? [])).toBeLessThan(32000)
    })
  })

  describe('brief-en', () => {
    const fixture = optimizerFixture('brief-en')!

    // The one fixture that must stay boring: a single turn with nothing
    // repeated is what an inert step is supposed to look like.
    it('leaves the conversation-shaped optimizers with nothing to do', () => {
      const ctx = ctxWith(fixture.messages)
      expect(sessionDedupOptimizer.supports(ctx)).toBe(false)
      expect(ccrOptimizer.supports(ctx)).toBe(false)
      expect(jsonTableOptimizer.supports(ctx)).toBe(false)
    })

    it('is still English prose caveman compresses', () => {
      const ctx = ctxWith(fixture.messages)
      expect(cavemanOptimizer.supports(ctx)).toBe(true)
      expect(saving(cavemanOptimizer, ctx)).toBeGreaterThan(0)
    })
  })

  it('returns undefined for an unknown id', () => {
    expect(optimizerFixture('nope')).toBeUndefined()
  })
})
