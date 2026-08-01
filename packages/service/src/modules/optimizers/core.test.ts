import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ChatCompletionRequest, Message, OptimizerClass } from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'
import type { Optimizer } from './registry.js'
import { readMessages, writeMessages } from './messages.js'
import { optimizerCoreModule } from './core.js'

function baseCtx(overrides: Partial<ProxyContext> = {}): ProxyContext {
  const messages: Message[] = [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hello world' },
  ]
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
    ...overrides,
  } as ProxyContext
}

function opt(id: string, klass: OptimizerClass, over: Partial<Optimizer> = {}): Optimizer {
  return {
    id: id as Optimizer['id'],
    klass,
    supports: () => true,
    estimate: () => ({ estimatedTokensBefore: 100, estimatedTokensAfter: 100 }),
    optimize: () => ({ changed: false, estimatedTokensBefore: 100, estimatedTokensAfter: 100 }),
    validate: () => true,
    ...over,
  }
}

async function setup(optimizers: Optimizer[]) {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  await optimizerCoreModule.register({ container, events })
  const registry = container.resolve(OPTIMIZER_REGISTRY)
  for (const o of optimizers) registry.register(o)
  const pipeline = container.resolve(PROXY_PIPELINE)
  const proc = pipeline.orderedFor('request.preprocess').find((p) => p.id === 'optimizer.apply')!
  return { proc }
}

describe('optimizer-core module', () => {
  it('contributes the optimizer.apply processor after pii + guardrail', async () => {
    const { proc } = await setup([])
    expect(proc.phase).toBe('request.preprocess')
    expect(proc.after).toEqual(['pii.input', 'guardrail.request'])
  })

  it('applies a lossless optimizer that drops a message, mutating ctx.request in place', async () => {
    const dropSystem = opt('session-dedup', 'lossless', {
      optimize: (ctx) => {
        writeMessages(ctx.request, readMessages(ctx.request).slice(1))
        return { changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 60 }
      },
    })
    const { proc } = await setup([dropSystem])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.request.messages).toHaveLength(1)
    expect(ctx.request.messages[0]!.content).toBe('hello world')
    // in-place: request/original still the same object
    expect(ctx.request).toBe(ctx.original)
  })

  it('fails open on a throwing optimizer: request unchanged, no error propagates', async () => {
    const boom = opt('session-dedup', 'lossless', {
      optimize: (ctx) => {
        writeMessages(ctx.request, [])
        throw new Error('boom')
      },
    })
    const { proc } = await setup([boom])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } } as any })
    expect(() => proc.run(ctx)).not.toThrow()
    expect(ctx.request.messages).toHaveLength(2)
    expect(ctx.request).toBe(ctx.original)
  })

  it('rolls back when validate returns false and calls recover', async () => {
    const recover = vi.fn()
    const rejected = opt('session-dedup', 'lossless', {
      optimize: (ctx) => {
        writeMessages(ctx.request, [])
        return { changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 0 }
      },
      validate: () => false,
      recover,
    })
    const { proc } = await setup([rejected])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.request.messages).toHaveLength(2)
    expect(recover).toHaveBeenCalledOnce()
  })

  it('rolls back a lossy optimizer that fails the safety gate', async () => {
    const overCompress = opt('llmlingua-2', 'lossy', {
      optimize: (ctx) => {
        writeMessages(ctx.request, [{ role: 'user', content: 'x' }])
        return { changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 5 }
      },
    })
    const { proc } = await setup([overCompress])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'llmlingua-2', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.request.messages).toHaveLength(2)
  })

  it('keeps a lossy optimizer with a moderate reduction (passes the gate)', async () => {
    const moderate = opt('llmlingua-2', 'lossy', {
      optimize: (ctx) => {
        writeMessages(ctx.request, [{ role: 'user', content: 'hi' }])
        return { changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 70 }
      },
    })
    const { proc } = await setup([moderate])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'llmlingua-2', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.request.messages).toHaveLength(1)
  })

  it('does not gate a lossless optimizer even below the floor ratio', async () => {
    const heavy = opt('session-dedup', 'lossless', {
      optimize: (ctx) => {
        writeMessages(ctx.request, [{ role: 'user', content: 'x' }])
        return { changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 2 }
      },
    })
    const { proc } = await setup([heavy])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.request.messages).toHaveLength(1)
  })

  it('skips disabled, absent, and unsupported steps', async () => {
    const optimize = vi.fn(() => ({ changed: true, estimatedTokensBefore: 100, estimatedTokensAfter: 60 }))
    const disabled = opt('session-dedup', 'lossless', { optimize })
    const unsupported = opt('ccr', 'lossless', { supports: () => false, optimize })
    const { proc } = await setup([disabled, unsupported])
    const ctx = baseCtx({
      project: {
        id: 'p1',
        optimizers: {
          steps: [
            { id: 'session-dedup', enabled: false }, // disabled
            { id: 'ccr', enabled: true }, // installed but supports=false
            { id: 'rtk', enabled: true }, // enabled but absent from registry
          ],
        },
      } as any,
    })
    await proc.run(ctx)
    expect(optimize).not.toHaveBeenCalled()
    expect(ctx.request.messages).toHaveLength(2)
  })

  it('runs optimizers in config array order', async () => {
    const calls: string[] = []
    const a = opt('session-dedup', 'lossless', { optimize: () => { calls.push('a'); return { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 } } })
    const b = opt('ccr', 'lossless', { optimize: () => { calls.push('b'); return { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 } } })
    const { proc } = await setup([a, b])
    const ctx = baseCtx({
      project: { id: 'p1', optimizers: { steps: [{ id: 'ccr', enabled: true }, { id: 'session-dedup', enabled: true }] } } as any,
    })
    await proc.run(ctx)
    expect(calls).toEqual(['b', 'a'])
  })

  it('no-ops when the project has no optimizers config', async () => {
    const optimize = vi.fn()
    const o = opt('session-dedup', 'lossless', { optimize })
    const { proc } = await setup([o])
    const ctx = baseCtx({ project: { id: 'p1' } as any })
    await proc.run(ctx)
    expect(optimize).not.toHaveBeenCalled()
  })

  it('skips when a prior processor already produced a result', async () => {
    const optimize = vi.fn()
    const o = opt('session-dedup', 'lossless', { optimize })
    const { proc } = await setup([o])
    const ctx = baseCtx({
      project: { id: 'p1', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } } as any,
      result: { kind: 'block' },
    })
    await proc.run(ctx)
    expect(optimize).not.toHaveBeenCalled()
  })
})

// ── Per-step stats for usage attribution (T63) ────────────────────────────────

describe('optimizer.apply — optimizerStats', () => {
  const shrink = (id: string, klass: OptimizerClass, before: number, after: number, over: Partial<Optimizer> = {}) =>
    opt(id, klass, {
      optimize: (ctx) => {
        writeMessages(ctx.request, [{ role: 'user', content: 'shorter' }])
        return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: after }
      },
      ...over,
    })

  it('records the token delta of every step that changed the prompt, in execution order', async () => {
    const { proc } = await setup([shrink('ccr', 'recoverable', 100, 60), shrink('rtk', 'recoverable', 60, 55)])
    const ctx = baseCtx({
      project: { id: 'p1', optimizers: { steps: [{ id: 'ccr', enabled: true }, { id: 'rtk', enabled: true }] } } as any,
    })
    await proc.run(ctx)
    expect(ctx.optimizerStats).toEqual([
      { id: 'ccr', tokensBefore: 100, tokensAfter: 60 },
      { id: 'rtk', tokensBefore: 60, tokensAfter: 55 },
    ])
  })

  it('leaves the field unset when no step changed anything', async () => {
    const inert = opt('session-dedup', 'lossless', {
      optimize: () => ({ changed: false, estimatedTokensBefore: 100, estimatedTokensAfter: 100 }),
    })
    const { proc } = await setup([inert])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.optimizerStats).toBeUndefined()
  })

  it('marks a gate-rejected lossy step as rolled back, with no saving credited', async () => {
    const { proc } = await setup([shrink('llmlingua-2', 'lossy', 100, 5)])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'llmlingua-2', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.optimizerStats).toEqual([
      { id: 'llmlingua-2', tokensBefore: 100, tokensAfter: 100, rolledBack: true },
    ])
  })

  it('marks a validate-rejected step as rolled back', async () => {
    const { proc } = await setup([shrink('ccr', 'recoverable', 100, 60, { validate: () => false })])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'ccr', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.optimizerStats).toEqual([{ id: 'ccr', tokensBefore: 100, tokensAfter: 100, rolledBack: true }])
  })

  it('records nothing for a step that threw: there is no result to measure', async () => {
    const boom = opt('ccr', 'recoverable', { optimize: () => { throw new Error('boom') } })
    const { proc } = await setup([boom])
    const ctx = baseCtx({ project: { id: 'p1', optimizers: { steps: [{ id: 'ccr', enabled: true }] } } as any })
    await proc.run(ctx)
    expect(ctx.optimizerStats).toBeUndefined()
  })
})
