import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import type { ChatCompletionRequest, Message } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages } from '../messages.js'
import { optimizerCoreModule } from '../core.js'
import { sessionDedupModule, sessionDedupOptimizer } from './index.js'

function ctxWith(messages: Message[]): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    project: { id: 'p1', optimizers: { steps: [] } } as any,
    projectId: 'p1',
    traceId: 't1',
    traceEnabled: false,
    traceSuppressed: false,
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as ProxyContext
}

const CONTEXT_BLOCK = 'You are a support agent. Company policy: always be polite. Docs: ...'

function texts(ctx: ProxyContext): string[] {
  return readMessages(ctx.request).map((m) => m.content as string)
}

describe('session-dedup optimizer', () => {
  it('is lossless with the session-dedup id', () => {
    expect(sessionDedupOptimizer.id).toBe('session-dedup')
    expect(sessionDedupOptimizer.klass).toBe('lossless')
  })

  it('drops verbatim-repeated middle blocks, keeping first and last occurrence', () => {
    const ctx = ctxWith([
      { role: 'system', content: CONTEXT_BLOCK }, // 0 first -> keep
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: CONTEXT_BLOCK }, // 3 middle -> drop
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'system', content: CONTEXT_BLOCK }, // 6 last -> keep
      { role: 'user', content: 'q3' },
    ])
    const result = sessionDedupOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const msgs = readMessages(ctx.request)
    expect(msgs).toHaveLength(7)
    // first and last CONTEXT_BLOCK retained, the middle one gone
    const blocks = msgs.filter((m) => m.content === CONTEXT_BLOCK)
    expect(blocks).toHaveLength(2)
    expect(msgs[0]!.content).toBe(CONTEXT_BLOCK)
    expect(msgs[msgs.length - 1]!.content).toBe('q3')
    // in-place mutation keeps request/original identity
    expect(ctx.request).toBe(ctx.original)
    expect(sessionDedupOptimizer.validate(ctx, result)).toBe(true)
  })

  it('leaves a conversation with no duplicates unchanged', () => {
    const ctx = ctxWith([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'bye' },
    ])
    const before = texts(ctx)
    const result = sessionDedupOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(texts(ctx)).toEqual(before)
    expect(sessionDedupOptimizer.validate(ctx, result)).toBe(true)
  })

  it('does not drop a block that repeats only twice (both are first+last)', () => {
    const ctx = ctxWith([
      { role: 'system', content: CONTEXT_BLOCK },
      { role: 'user', content: 'q1' },
      { role: 'system', content: CONTEXT_BLOCK },
    ])
    const result = sessionDedupOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toHaveLength(3)
  })

  it('dedups only exact role+text matches (same text, different role kept)', () => {
    const ctx = ctxWith([
      { role: 'user', content: 'ping' },
      { role: 'assistant', content: 'ping' },
      { role: 'user', content: 'ping' },
      { role: 'assistant', content: 'ping' },
      { role: 'user', content: 'ping' },
    ])
    const result = sessionDedupOptimizer.optimize(ctx)
    // user 'ping' at 0,2,4 -> drop 2; assistant 'ping' at 1,3 -> keep both
    expect(result.changed).toBe(true)
    const msgs = readMessages(ctx.request)
    expect(msgs).toHaveLength(4)
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(2)
  })

  it('does NOT dedup distinct image-only messages that share an empty text portion', () => {
    // text-only keys would flatten all three to '' and drop the middle image — data loss.
    const ctx = ctxWith([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/a.png' } }] },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/b.png' } }] },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/c.png' } }] },
    ])
    const result = sessionDedupOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toHaveLength(3)
    expect(sessionDedupOptimizer.validate(ctx, result)).toBe(true)
  })

  it('does NOT dedup tool-call turns that share text but differ by tool_call_id', () => {
    const ctx = ctxWith([
      { role: 'tool', content: 'result', tool_call_id: 't1' },
      { role: 'tool', content: 'result', tool_call_id: 't2' },
      { role: 'tool', content: 'result', tool_call_id: 't3' },
    ])
    const result = sessionDedupOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toHaveLength(3)
  })

  it('validate rejects a result that lost unique content', () => {
    const ctx = ctxWith([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
    sessionDedupOptimizer.optimize(ctx)
    // simulate a bad post-state: a unique text disappeared
    ctx.request.messages = [{ role: 'user', content: 'a' }]
    expect(
      sessionDedupOptimizer.validate(ctx, {
        changed: true,
        estimatedTokensBefore: 2,
        estimatedTokensAfter: 1,
      }),
    ).toBe(false)
  })

  it('validate rejects a result whose token count grew', () => {
    const ctx = ctxWith([{ role: 'user', content: 'a' }])
    expect(
      sessionDedupOptimizer.validate(ctx, {
        changed: true,
        estimatedTokensBefore: 1,
        estimatedTokensAfter: 2,
      }),
    ).toBe(false)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith([{ role: 'user', content: 'a' }])
    expect(
      sessionDedupOptimizer.validate(ctx, {
        changed: false,
        estimatedTokensBefore: 1,
        estimatedTokensAfter: 1,
      }),
    ).toBe(true)
  })

  it('validate rejects when a unique block was swapped (same count, different text)', () => {
    const ctx = ctxWith([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
    sessionDedupOptimizer.optimize(ctx)
    ctx.request.messages = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'c' },
    ]
    expect(
      sessionDedupOptimizer.validate(ctx, {
        changed: true,
        estimatedTokensBefore: 2,
        estimatedTokensAfter: 2,
      }),
    ).toBe(false)
  })

  it('supports requires more than one message', () => {
    expect(sessionDedupOptimizer.supports(ctxWith([{ role: 'user', content: 'hi' }]))).toBe(false)
    expect(
      sessionDedupOptimizer.supports(
        ctxWith([
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'yo' },
        ]),
      ),
    ).toBe(true)
  })

  it('estimate previews the token reduction without mutating', () => {
    const ctx = ctxWith([
      { role: 'system', content: CONTEXT_BLOCK },
      { role: 'user', content: 'q1' },
      { role: 'system', content: CONTEXT_BLOCK },
      { role: 'user', content: 'q2' },
      { role: 'system', content: CONTEXT_BLOCK },
    ])
    const est = sessionDedupOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBeLessThan(est.estimatedTokensBefore)
    // estimate is read-only
    expect(readMessages(ctx.request)).toHaveLength(5)
  })

  it('registers into OPTIMIZER_REGISTRY via its module', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await sessionDedupModule.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('session-dedup')).toBe(sessionDedupOptimizer)
  })

  it('module manifest depends on optimizer-core', () => {
    expect(sessionDedupModule.manifest.id).toBe('optimizer-session-dedup')
    expect(sessionDedupModule.manifest.dependsOn).toEqual({ 'optimizer-core': '^0.4.0' })
  })
})
