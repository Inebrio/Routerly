import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import { OPTIMIZER_CATALOG } from '@routerly/shared'
import type { ChatCompletionRequest, Message, OptimizerStep } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages } from '../messages.js'
import { passesSafetyGate } from '../gate.js'
import { optimizerCoreModule } from '../core.js'
import { relevanceModule, relevanceOptimizer } from './index.js'
import { PRODUCT_VERSION } from '../../../core/version.js'

function ctxWith(messages: Message[], threshold?: number): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  const steps: OptimizerStep[] =
    threshold === undefined ? [] : [{ id: 'relevance', enabled: true, threshold }]
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    project: { id: 'p1', optimizers: { steps } } as any,
    projectId: 'p1',
    traceId: 't1',
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as ProxyContext
}

// turn1: shares "cats"/"dogs" with the newest turn -> above a low threshold, kept.
// turn2: shares nothing with the newest turn -> below threshold, dropped whole.
const RELATED: Message[] = [
  { role: 'user', content: 'tell me about cats and dogs' },
  { role: 'assistant', content: 'cats and dogs are pets' },
]
const UNRELATED: Message[] = [
  { role: 'user', content: 'what is the weather today' },
  { role: 'assistant', content: 'it is sunny' },
]
const NEWEST: Message[] = [{ role: 'user', content: 'do you like cats or dogs more' }]

function conversation(): Message[] {
  return [{ role: 'system', content: 'sys' }, ...RELATED, ...UNRELATED, ...NEWEST]
}

describe('relevance optimizer', () => {
  it('is lossy with the relevance id', () => {
    expect(relevanceOptimizer.id).toBe('relevance')
    expect(relevanceOptimizer.klass).toBe('lossy')
  })

  it('supports is true with no threshold on the step: the catalog default applies', () => {
    // Enabling the step is the opt-in. Requiring a second number on top of it
    // left the optimizer silently inert for anyone who enabled it and saved.
    expect(relevanceOptimizer.supports(ctxWith(conversation()))).toBe(true)
  })

  it('supports is true once a threshold is set and there is an older turn to score', () => {
    expect(relevanceOptimizer.supports(ctxWith(conversation(), 0.1))).toBe(true)
  })

  it('supports is false when only the newest turn exists (nothing older to score)', () => {
    expect(relevanceOptimizer.supports(ctxWith([{ role: 'system', content: 'sys' }, ...NEWEST], 0.1))).toBe(false)
  })

  it('drops a low-relevance turn and keeps a higher-relevance turn against the newest turn', () => {
    // jaccard(related, newest) = 2/13 ~= 0.1538; jaccard(unrelated, newest) = 0
    const ctx = ctxWith(conversation(), 0.1)
    const result = relevanceOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)

    const msgs = readMessages(ctx.request)
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' })
    // related turn survives
    expect(msgs).toEqual(expect.arrayContaining(RELATED))
    // unrelated turn is gone entirely (whole-turn drop, not partial)
    expect(msgs.some((m) => m.content === UNRELATED[0]!.content)).toBe(false)
    expect(msgs.some((m) => m.content === UNRELATED[1]!.content)).toBe(false)
    // newest turn always survives verbatim
    expect(msgs[msgs.length - 1]).toEqual(NEWEST[0])
    expect(ctx.request).toBe(ctx.original)
    expect(relevanceOptimizer.validate(ctx, result)).toBe(true)
  })

  it('keeps everything when every older turn meets the threshold', () => {
    const ctx = ctxWith(conversation(), 0) // threshold 0 -> everything with any overlap (or none) passes: 0 >= 0
    const before = readMessages(ctx.request).slice()
    const result = relevanceOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('never drops the newest turn, even when it scores irrelevant against itself', () => {
    const ctx = ctxWith([{ role: 'system', content: 'sys' }, ...UNRELATED, ...NEWEST], 0.9)
    const result = relevanceOptimizer.optimize(ctx)
    const msgs = readMessages(ctx.request)
    expect(msgs[msgs.length - 1]).toEqual(NEWEST[0])
    expect(relevanceOptimizer.validate(ctx, result)).toBe(true)
  })

  it('estimate and optimize fall back to the catalog default when no threshold is configured', () => {
    const fallback = relevanceOptimizer.estimate(ctxWith(conversation()))
    const explicit = relevanceOptimizer.estimate(
      ctxWith(conversation(), OPTIMIZER_CATALOG.relevance.threshold!.default!),
    )
    expect(fallback).toEqual(explicit)

    const ctx = ctxWith(conversation())
    const result = relevanceOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    // the unrelated turn goes, exactly as it does with an explicit 0.1
    expect(readMessages(ctx.request).some((m) => m.content === UNRELATED[0]!.content)).toBe(false)
  })

  it('is a no-op when there is only the newest turn (nothing older to score)', () => {
    const ctx = ctxWith([{ role: 'system', content: 'sys' }, ...NEWEST], 0.1)
    const result = relevanceOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual([{ role: 'system', content: 'sys' }, ...NEWEST])
  })

  it('estimate previews the reduction without mutating', () => {
    const ctx = ctxWith(conversation(), 0.1)
    const est = relevanceOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBeLessThan(est.estimatedTokensBefore)
    expect(readMessages(ctx.request)).toEqual(conversation()) // untouched
  })

  it('validate fails when the newest turn was lost after optimize', () => {
    const ctx = ctxWith(conversation(), 0.1)
    const result = relevanceOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).slice(0, -1)
    expect(relevanceOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate fails when the system message was lost after optimize', () => {
    const ctx = ctxWith(conversation(), 0.1)
    const result = relevanceOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).filter((m) => m.role !== 'system')
    expect(relevanceOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith(conversation(), 0.1)
    expect(
      relevanceOptimizer.validate(ctx, { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 }),
    ).toBe(true)
  })

  it('recover restores the original messages when explicitly invoked', () => {
    const ctx = ctxWith(conversation(), 0.1)
    const original = readMessages(ctx.request).slice()
    relevanceOptimizer.optimize(ctx)
    expect(readMessages(ctx.request).length).toBeLessThan(original.length)
    ctx.request.messages = [{ role: 'user', content: 'garbage' }]
    relevanceOptimizer.recover!(ctx, { changed: true, estimatedTokensBefore: 0, estimatedTokensAfter: 0 })
    expect(readMessages(ctx.request)).toEqual(original)
    expect(ctx.request).toBe(ctx.original)
  })

  it('recover is a safe no-op when nothing was stashed', () => {
    const ctx = ctxWith(conversation(), 0.1)
    const before = readMessages(ctx.request).slice()
    expect(() =>
      relevanceOptimizer.recover!(ctx, { changed: false, estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    ).not.toThrow()
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('never splits an Anthropic tool_use/tool_result pair when its turn is dropped', () => {
    const toolUse = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'get', input: {} }],
    } as unknown as Message
    const toolResult = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'zzz completely unrelated payload' }],
    } as unknown as Message
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'unrelated tool call turn' },
      toolUse,
      toolResult,
      { role: 'assistant', content: 'unrelated wrap up' },
      ...NEWEST,
    ]
    const ctx = ctxWith(msgs, 0.9) // high threshold: the tool turn (irrelevant to newest) is dropped whole
    const result = relevanceOptimizer.optimize(ctx)
    const out = readMessages(ctx.request)
    const hasUse = out.some((m) => m === toolUse)
    const hasResult = out.some((m) => m === toolResult)
    expect(hasUse).toBe(hasResult) // both present or both absent, never split
    expect(relevanceOptimizer.validate(ctx, result)).toBe(true)
  })

  it('a too-aggressive drop (threshold set so nearly everything is dropped) is rejected by the core safety gate', () => {
    // Five older turns, all lexically unrelated to the tiny newest turn; a high
    // threshold drops all of them, leaving only the newest turn -> ratio < 0.2 floor.
    const msgs: Message[] = [{ role: 'system', content: 'sys' }]
    const topics = ['weather rain storm clouds', 'football score match goal', 'recipe pasta tomato sauce', 'car engine oil brake', 'music guitar drums song']
    for (const t of topics) {
      msgs.push({ role: 'user', content: t })
      msgs.push({ role: 'assistant', content: `${t} more detail padding text here` })
    }
    msgs.push(...NEWEST)
    const ctx = ctxWith(msgs, 0.9)
    const result = relevanceOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    expect(passesSafetyGate(result)).toBe(false)
  })

  it('registers into OPTIMIZER_REGISTRY via its module', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await relevanceModule.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('relevance')).toBe(relevanceOptimizer)
  })

  it('module manifest depends on optimizer-core', () => {
    expect(relevanceModule.manifest.id).toBe('optimizer-relevance')
    expect(relevanceModule.manifest.dependsOn).toEqual({ 'optimizer-core': `^${PRODUCT_VERSION}` })
  })
})
