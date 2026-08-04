import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import type { ChatCompletionRequest, Message } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages, tokensOf as sharedTokensOf } from '../messages.js'
import { optimizerCoreModule } from '../core.js'
import { rtkModule, rtkOptimizer } from './index.js'
import { PRODUCT_VERSION } from '../../../core/version.js'

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
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as ProxyContext
}

const BOILERPLATE =
  'This is a repeated round-trip framing block that scaffolds every tool response with the same instructions text padded to be long enough to count as boilerplate.'

describe('rtk optimizer', () => {
  it('is recoverable with the rtk id', () => {
    expect(rtkOptimizer.id).toBe('rtk')
    expect(rtkOptimizer.klass).toBe('recoverable')
  })

  it('collapses redundant whitespace within a message', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello     world\n\n\n\n\nnext paragraph' },
    ]
    const ctx = ctxWith(msgs)
    const result = rtkOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const [out] = readMessages(ctx.request)
    expect(out!.content).toBe('hello world\n\nnext paragraph')
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore)
  })

  it('strips repeated boilerplate blocks, keeping the first occurrence', () => {
    const content = `${BOILERPLATE}\n\nactual question one\n\n${BOILERPLATE}\n\nactual question two\n\n${BOILERPLATE}`
    const msgs: Message[] = [{ role: 'user', content }]
    const ctx = ctxWith(msgs)
    const result = rtkOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const [out] = readMessages(ctx.request)
    const text = out!.content as string
    expect(text.split(BOILERPLATE)).toHaveLength(2) // exactly one occurrence left
    expect(text).toContain('actual question one')
    expect(text).toContain('actual question two')
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore)
  })

  it('is a no-op on a message with no redundant whitespace/boilerplate', () => {
    const msgs: Message[] = [{ role: 'user', content: 'plain single line' }]
    const ctx = ctxWith(msgs)
    expect(rtkOptimizer.supports(ctx)).toBe(false)
    const result = rtkOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual(msgs)
  })

  it('never touches non-text content parts (images, tool_use, tool_result)', () => {
    const msgs: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'caption     text' },
          { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
        ],
      } as unknown as Message,
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu1', name: 'get', input: {} }],
      } as unknown as Message,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok    ok' }],
      } as unknown as Message,
    ]
    const ctx = ctxWith(msgs)
    const result = rtkOptimizer.optimize(ctx)
    const out = readMessages(ctx.request)
    // image_url part untouched
    expect((out[0]!.content as any[])[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/x.png' },
    })
    // text part inside the array IS compacted
    expect((out[0]!.content as any[])[0]).toEqual({ type: 'text', text: 'caption text' })
    // tool_use block untouched verbatim (no "type: text", never inspected)
    expect(out[1]).toEqual(msgs[1])
    // tool_result block untouched verbatim (duck-typed, no "type: text")
    expect(out[2]).toEqual(msgs[2])
    expect(result).toBeTruthy()
  })

  it('never drops, reorders, or merges messages', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'sys   prompt' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1     with   spaces' },
    ]
    const ctx = ctxWith(msgs)
    rtkOptimizer.optimize(ctx)
    const out = readMessages(ctx.request)
    expect(out).toHaveLength(3)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
  })

  it('validate passes when semantic content markers survive compaction', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello     world\n\n\n\nmarker-content-here' }]
    const ctx = ctxWith(msgs)
    const result = rtkOptimizer.optimize(ctx)
    expect(rtkOptimizer.validate(ctx, result)).toBe(true)
  })

  it('validate fails when semantic content was lost after optimize', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello     world\n\n\n\nmarker-content-here' }]
    const ctx = ctxWith(msgs)
    const result = rtkOptimizer.optimize(ctx)
    ctx.request.messages = [{ role: 'user', content: 'hello world' }] // marker text lost
    expect(rtkOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate fails when a message is dropped', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'u1     x' },
      { role: 'assistant', content: 'a1     y' },
    ]
    const ctx = ctxWith(msgs)
    const result = rtkOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).slice(0, 1)
    expect(rtkOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith([{ role: 'user', content: 'hi' }])
    expect(
      rtkOptimizer.validate(ctx, { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 }),
    ).toBe(true)
  })

  it('recover restores the original messages when explicitly invoked', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello     world\n\n\n\nnext' }]
    const ctx = ctxWith(msgs)
    const original = readMessages(ctx.request).slice()
    const result = rtkOptimizer.optimize(ctx)
    expect(readMessages(ctx.request)).not.toEqual(original)
    // core would have restored ctx.request already; recover is a defensive re-write.
    ctx.request.messages = [{ role: 'user', content: 'garbage' }]
    rtkOptimizer.recover!(ctx, result)
    expect(readMessages(ctx.request)).toEqual(original)
    expect(ctx.request).toBe(ctx.original)
  })

  it('recover is a safe no-op when nothing was stashed', () => {
    const ctx = ctxWith([{ role: 'user', content: 'hi' }])
    const before = readMessages(ctx.request).slice()
    expect(() =>
      rtkOptimizer.recover!(ctx, { changed: false, estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    ).not.toThrow()
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('estimate previews the reduction without mutating', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello     world\n\n\n\nnext' }]
    const ctx = ctxWith(msgs)
    const est = rtkOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBeLessThan(est.estimatedTokensBefore)
    expect(readMessages(ctx.request)).toEqual(msgs) // untouched
  })

  it('estimate reports no change on already-compact content', () => {
    const ctx = ctxWith([{ role: 'user', content: 'plain single line' }])
    const est = rtkOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBe(est.estimatedTokensBefore)
  })

  it('registers into OPTIMIZER_REGISTRY via its module', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await rtkModule.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('rtk')).toBe(rtkOptimizer)
  })

  it('counts tokens the same way the rest of the pipeline does', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'one    two     three' }] },
    ]
    const ctx = ctxWith(messages)
    const result = rtkOptimizer.optimize(ctx) as { estimatedTokensBefore: number }
    expect(result.estimatedTokensBefore).toBe(sharedTokensOf(messages))
  })

  it('module manifest depends on optimizer-core', () => {
    expect(rtkModule.manifest.id).toBe('optimizer-rtk')
    expect(rtkModule.manifest.dependsOn).toEqual({ 'optimizer-core': `^${PRODUCT_VERSION}` })
  })
})
