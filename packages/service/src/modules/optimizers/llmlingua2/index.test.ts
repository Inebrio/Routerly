import { afterEach, describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import type { ChatCompletionRequest, Message } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages } from '../messages.js'
import { passesSafetyGate } from '../gate.js'
import { optimizerCoreModule } from '../core.js'
import * as model from './model.js'
import { llmlingua2Module, llmlingua2Optimizer } from './index.js'
import { PRODUCT_VERSION } from '../../../core/version.js'

function ctxWith(messages: Message[], threshold?: number, modelKey?: string): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  const step = {
    id: 'llmlingua-2',
    enabled: true,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(modelKey !== undefined ? { model: modelKey } : {}),
  }
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    router: { id: 'p1', optimizers: { steps: [step] } } as any,
    routerId: 'p1',
    traceId: 't1',
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as ProxyContext
}

function textOf(m: Message): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
}

/** Make the optimizer "available": model on disk + runtime installed. */
function makeAvailable(): void {
  vi.spyOn(model, 'isModelAvailable').mockReturnValue(true)
  vi.spyOn(model, 'isRuntimeInstalled').mockReturnValue(true)
}

afterEach(() => vi.restoreAllMocks())

describe('llmlingua-2 optimizer', () => {
  it('is lossy with the llmlingua-2 id', () => {
    expect(llmlingua2Optimizer.id).toBe('llmlingua-2')
    expect(llmlingua2Optimizer.klass).toBe('lossy')
  })

  it('supports() is false by default (no model on disk, runtime not installed)', () => {
    const ctx = ctxWith([{ role: 'user', content: 'anything at all here' }])
    // Real model.ts in the test env: no checkpoint, no onnxruntime-node.
    expect(llmlingua2Optimizer.supports(ctx)).toBe(false)
  })

  it('supports() is false when the step is disabled even if model+runtime present', () => {
    makeAvailable()
    const ctx = ctxWith([{ role: 'user', content: 'x y z' }])
    ;(ctx.router as any).optimizers.steps[0].enabled = false
    expect(llmlingua2Optimizer.supports(ctx)).toBe(false)
  })

  it('supports() is false when the runtime is installed but the model is absent', () => {
    vi.spyOn(model, 'isModelAvailable').mockReturnValue(false)
    vi.spyOn(model, 'isRuntimeInstalled').mockReturnValue(true)
    const ctx = ctxWith([{ role: 'user', content: 'x y z' }])
    expect(llmlingua2Optimizer.supports(ctx)).toBe(false)
  })

  it('supports() is true when step enabled AND model+runtime available', () => {
    makeAvailable()
    const ctx = ctxWith([{ role: 'user', content: 'x y z' }])
    expect(llmlingua2Optimizer.supports(ctx)).toBe(true)
  })

  it('optimize compresses string content via the model and reports fewer tokens', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('database schema indexes')
    const ctx = ctxWith([
      { role: 'user', content: 'could you please tell me about the database schema and its indexes now' },
    ])
    const result = await llmlingua2Optimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    expect(textOf(readMessages(ctx.request)[0]!)).toBe('database schema indexes')
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore)
    expect(llmlingua2Optimizer.validate(ctx, result)).toBe(true)
    expect(ctx.request).toBe(ctx.original) // in-place mutation, aliasing preserved
  })

  it('passes the step threshold through as the keep-ratio', async () => {
    makeAvailable()
    const spy = vi.spyOn(model, 'compress').mockResolvedValue('kept')
    const ctx = ctxWith([{ role: 'user', content: 'a b c d e f' }], 0.3)
    await llmlingua2Optimizer.optimize(ctx)
    expect(spy).toHaveBeenCalledWith('a b c d e f', 0.3, undefined)
  })

  it('runs on the checkpoint the step names', async () => {
    makeAvailable()
    const spy = vi.spyOn(model, 'compress').mockResolvedValue('kept')
    const ctx = ctxWith([{ role: 'user', content: 'a b c d e f' }], 0.3, 'xlm-roberta-large-int8')
    await llmlingua2Optimizer.optimize(ctx)
    expect(spy).toHaveBeenCalledWith('a b c d e f', 0.3, 'xlm-roberta-large-int8')
  })

  it('names the missing checkpoint in the skip reason', () => {
    vi.spyOn(model, 'isRuntimeInstalled').mockReturnValue(true)
    vi.spyOn(model, 'isModelAvailable').mockReturnValue(false)
    const ctx = ctxWith([{ role: 'user', content: 'a b c' }], undefined, 'xlm-roberta-large-int8')
    expect(llmlingua2Optimizer.explain!(ctx)).toContain('XLM-RoBERTa large, int8')
  })

  it('compresses only text parts of array content, leaving non-text parts byte-identical', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('describe image')
    const image = { type: 'image_url', image_url: { url: 'https://img/x.png' } }
    const msg = {
      role: 'user',
      content: [{ type: 'text', text: 'please describe the image for me' }, image],
    } as unknown as Message
    const ctx = ctxWith([msg])
    const result = await llmlingua2Optimizer.optimize(ctx)
    const out = readMessages(ctx.request)[0]! as any
    expect(out.content[0].text).toBe('describe image')
    expect(out.content[1]).toEqual(image)
    expect(llmlingua2Optimizer.validate(ctx, result)).toBe(true)
  })

  it('is a no-op when the model returns the text unchanged', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockImplementation(async (t: string) => t)
    const ctx = ctxWith([{ role: 'user', content: 'already minimal text' }])
    const before = readMessages(ctx.request).slice()
    const result = await llmlingua2Optimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('an over-aggressive compression is rejected by the lossy safety gate', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('x') // collapse to almost nothing
    const ctx = ctxWith([
      { role: 'user', content: 'a long user message with a great many words to compress down hard now indeed' },
    ])
    const result = await llmlingua2Optimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    expect(passesSafetyGate(result)).toBe(false)
  })

  it('validate rejects an emptied message', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('kept text')
    const ctx = ctxWith([{ role: 'user', content: 'some real content here' }])
    const result = await llmlingua2Optimizer.optimize(ctx)
    ctx.request.messages = [{ role: 'user', content: '' }] // emptied out
    expect(llmlingua2Optimizer.validate(ctx, result)).toBe(false)
  })

  it('validate rejects a grown message', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('kept')
    const ctx = ctxWith([{ role: 'user', content: 'short' }])
    const result = await llmlingua2Optimizer.optimize(ctx)
    ctx.request.messages = [{ role: 'user', content: 'a much much longer replacement string' }]
    expect(llmlingua2Optimizer.validate(ctx, result)).toBe(false)
  })

  it('validate rejects a changed message count', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('kept')
    const ctx = ctxWith([
      { role: 'user', content: 'first message content' },
      { role: 'assistant', content: 'second message content' },
    ])
    const result = await llmlingua2Optimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).slice(0, 1)
    expect(llmlingua2Optimizer.validate(ctx, result)).toBe(false)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith([{ role: 'user', content: 'anything' }])
    expect(
      llmlingua2Optimizer.validate(ctx, { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 }),
    ).toBe(true)
  })

  it('estimate previews the keep-ratio reduction without mutating', () => {
    const original: Message[] = [{ role: 'user', content: 'a fairly long message that should shrink' }]
    const ctx = ctxWith(original.map((m) => ({ ...m })), 0.4)
    const est = llmlingua2Optimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBeLessThan(est.estimatedTokensBefore)
    expect(readMessages(ctx.request)).toEqual(original)
  })

  it('recover restores the original messages when explicitly invoked', async () => {
    makeAvailable()
    vi.spyOn(model, 'compress').mockResolvedValue('compressed')
    const ctx = ctxWith([{ role: 'user', content: 'original user content here' }])
    const original = readMessages(ctx.request).slice()
    await llmlingua2Optimizer.optimize(ctx)
    ctx.request.messages = [{ role: 'user', content: 'garbage' }]
    llmlingua2Optimizer.recover!(ctx, { changed: true, estimatedTokensBefore: 0, estimatedTokensAfter: 0 })
    expect(readMessages(ctx.request)).toEqual(original)
    expect(ctx.request).toBe(ctx.original)
  })

  it('recover is a safe no-op when nothing was stashed', () => {
    const ctx = ctxWith([{ role: 'user', content: 'content' }])
    const before = readMessages(ctx.request).slice()
    expect(() =>
      llmlingua2Optimizer.recover!(ctx, { changed: false, estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    ).not.toThrow()
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('registers into OPTIMIZER_REGISTRY regardless of model/runtime availability', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await llmlingua2Module.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('llmlingua-2')).toBe(llmlingua2Optimizer)
  })

  it('module manifest depends on optimizer-core', () => {
    expect(llmlingua2Module.manifest.id).toBe('optimizer-llmlingua2')
    expect(llmlingua2Module.manifest.dependsOn).toEqual({ 'optimizer-core': `^${PRODUCT_VERSION}` })
  })
})
