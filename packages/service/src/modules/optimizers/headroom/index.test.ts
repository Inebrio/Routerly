import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import type { ChatCompletionRequest, Message, ModelConfig, OptimizerStep } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages } from '../messages.js'
import { optimizerCoreModule } from '../core.js'
import { headroomModule, headroomOptimizer } from './index.js'

interface CtxOpts {
  threshold?: number
  contextWindow?: number | undefined
  noAttempt?: boolean
}

function ctxWith(messages: Message[], opts: CtxOpts = {}): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  const steps: OptimizerStep[] =
    opts.threshold === undefined ? [] : [{ id: 'headroom', enabled: true, threshold: opts.threshold }]
  const attempt = opts.noAttempt
    ? undefined
    : ({ model: { contextWindow: opts.contextWindow } as unknown as ModelConfig, candidate: {} as any } as ProxyContext['attempt'])
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    project: { id: 'p1', optimizers: { steps } } as any,
    projectId: 'p1',
    traceId: 't1',
    traceEnabled: false,
    traceSuppressed: false,
    original: request,
    request,
    stream: false,
    passthrough: false,
    attempt,
  } as ProxyContext
}

// 40-char content per message -> ceil(40/4) = 10 tokens each, 20 tokens/turn.
const PAD = 'x'.repeat(38)
function turn(n: number): Message[] {
  return [
    { role: 'user', content: `q${n}${PAD}` },
    { role: 'assistant', content: `a${n}${PAD}` },
  ]
}
function conversation(n: number, withSystem = true): Message[] {
  const msgs: Message[] = []
  if (withSystem) msgs.push({ role: 'system', content: 'sys' }) // 1 token
  for (let i = 1; i <= n; i++) msgs.push(...turn(i))
  return msgs
}

describe('headroom optimizer', () => {
  it('is lossless with the headroom id', () => {
    expect(headroomOptimizer.id).toBe('headroom')
    expect(headroomOptimizer.klass).toBe('lossless')
  })

  it('supports is false when there is no routing attempt yet', () => {
    const ctx = ctxWith(conversation(5), { threshold: 20, noAttempt: true })
    expect(headroomOptimizer.supports(ctx)).toBe(false)
  })

  it('supports is false when the model has no known context window', () => {
    expect(headroomOptimizer.supports(ctxWith(conversation(5), { threshold: 20, contextWindow: undefined }))).toBe(
      false,
    )
    expect(headroomOptimizer.supports(ctxWith(conversation(5), { threshold: 20, contextWindow: 0 }))).toBe(false)
  })

  it('supports is false when the prompt already fits within the reserved headroom', () => {
    // system(1) + 3 turns(20 each) = 61 tokens; window 2000 - default 1024 = 976 budget
    const ctx = ctxWith(conversation(3), { contextWindow: 2000 })
    expect(headroomOptimizer.supports(ctx)).toBe(false)
    const result = headroomOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual(conversation(3))
  })

  it('trims the oldest turns until the prompt fits, keeping system and newest turns', () => {
    // system(1) + 5 turns(20 each) = 101 tokens; window 100 - threshold 20 = budget 80
    const ctx = ctxWith(conversation(5), { threshold: 20, contextWindow: 100 })
    expect(headroomOptimizer.supports(ctx)).toBe(true)

    const result = headroomOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    expect(result.estimatedTokensBefore).toBe(101)
    expect(result.estimatedTokensAfter).toBe(61) // system + turns 3,4,5

    const msgs = readMessages(ctx.request)
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' })
    // turns 1 and 2 (oldest) dropped in full
    expect(msgs.some((m) => m.content === `q1${PAD}`)).toBe(false)
    expect(msgs.some((m) => m.content === `q2${PAD}`)).toBe(false)
    // turns 3-5 survive verbatim
    expect(msgs).toEqual([{ role: 'system', content: 'sys' }, ...turn(3), ...turn(4), ...turn(5)])
    expect(ctx.request).toBe(ctx.original)
    expect(headroomOptimizer.validate(ctx, result)).toBe(true)
  })

  it('stops at the newest turn even if it alone still exceeds budget', () => {
    // system(1) + 2 turns(20 each) = 41 tokens; window 25 - threshold 5 = budget 20
    const ctx = ctxWith(conversation(2), { threshold: 5, contextWindow: 25 })
    const result = headroomOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const msgs = readMessages(ctx.request)
    expect(msgs).toEqual([{ role: 'system', content: 'sys' }, ...turn(2)])
    expect(headroomOptimizer.validate(ctx, result)).toBe(true)
  })

  it('uses a custom threshold as the reserved headroom, and non-positive falls back to default', () => {
    const messages = conversation(5)
    const custom = ctxWith(messages, { threshold: 20, contextWindow: 100 })
    expect(headroomOptimizer.supports(custom)).toBe(true) // budget 80, before 101

    const zero = ctxWith(messages, { threshold: 0, contextWindow: 100 })
    // default reserved 1024 -> budget negative, still "exceeds" -> supports true
    expect(headroomOptimizer.supports(zero)).toBe(true)

    const large = ctxWith(conversation(1), { threshold: 0, contextWindow: 100000 })
    // default reserved 1024, budget huge -> tiny conversation fits
    expect(headroomOptimizer.supports(large)).toBe(false)
  })

  it('validate fails when the newest turn was lost after optimize', () => {
    const ctx = ctxWith(conversation(5), { threshold: 20, contextWindow: 100 })
    const result = headroomOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).slice(0, -2)
    expect(headroomOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate fails when the system message was lost after optimize', () => {
    const ctx = ctxWith(conversation(5), { threshold: 20, contextWindow: 100 })
    const result = headroomOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).filter((m) => m.role !== 'system')
    expect(headroomOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith(conversation(2), { threshold: 20, contextWindow: 100 })
    expect(
      headroomOptimizer.validate(ctx, { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 }),
    ).toBe(true)
  })

  it('recover restores the original messages when explicitly invoked', () => {
    const ctx = ctxWith(conversation(5), { threshold: 20, contextWindow: 100 })
    const original = readMessages(ctx.request).slice()
    headroomOptimizer.optimize(ctx)
    expect(readMessages(ctx.request).length).toBeLessThan(original.length)
    // core would have restored ctx.request already; recover is a defensive re-write.
    ctx.request.messages = [{ role: 'user', content: 'garbage' }]
    headroomOptimizer.recover!(ctx, { changed: true, estimatedTokensBefore: 0, estimatedTokensAfter: 0 })
    expect(readMessages(ctx.request)).toEqual(original)
    expect(ctx.request).toBe(ctx.original)
  })

  it('recover is a safe no-op when nothing was stashed', () => {
    const ctx = ctxWith(conversation(2), { threshold: 20, contextWindow: 100 })
    const before = readMessages(ctx.request).slice()
    expect(() =>
      headroomOptimizer.recover!(ctx, { changed: false, estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    ).not.toThrow()
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('keeps an Anthropic tool_use/tool_result pair together when its turn is kept', () => {
    const toolUse = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'get', input: {} }],
    } as unknown as Message
    const toolResult = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
    } as unknown as Message
    const msgs: Message[] = [
      { role: 'system', content: 'sys' }, // 1 token
      ...turn(1), // 20 tokens, oldest — should be dropped
      { role: 'user', content: [{ type: 'text', text: 'u2' }] } as unknown as Message, // small
      toolUse,
      toolResult,
      { role: 'assistant', content: 'a2' }, // small — newest turn, kept whole
    ]
    // Budget large enough to keep the pair's turn (which is also the newest —
    // toolResult doesn't open a new turn, so a2 stays inside it), but not turn 1.
    const ctx = ctxWith(msgs, { threshold: 5, contextWindow: 20 })
    const result = headroomOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const out = readMessages(ctx.request)
    expect(out).toContainEqual(toolUse)
    expect(out).toContainEqual(toolResult)
    const iUse = out.findIndex((m) => m === toolUse)
    expect(out[iUse + 1]).toBe(toolResult)
    expect(out.some((m) => m.content === `q1${PAD}`)).toBe(false)
    expect(headroomOptimizer.validate(ctx, result)).toBe(true)
  })

  it('drops an Anthropic tool_use/tool_result pair together (never split) when its turn is trimmed', () => {
    const toolUse = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'get', input: {} }],
    } as unknown as Message
    const toolResult = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
    } as unknown as Message
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'u1' }] } as unknown as Message,
      toolUse,
      toolResult,
      { role: 'assistant', content: `a1${PAD}` }, // pads turn 1 so it's the heavy, older turn
      ...turn(2), // newest turn, kept
    ]
    // Tight budget: only the newest turn (and system) fit.
    const ctx = ctxWith(msgs, { threshold: 5, contextWindow: 30 })
    const result = headroomOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const out = readMessages(ctx.request)
    expect(out.some((m) => m === toolUse)).toBe(false)
    expect(out.some((m) => m === toolResult)).toBe(false)
    expect(out).toEqual([{ role: 'system', content: 'sys' }, ...turn(2)])
    expect(headroomOptimizer.validate(ctx, result)).toBe(true)
  })

  it('registers into OPTIMIZER_REGISTRY via its module', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await headroomModule.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('headroom')).toBe(headroomOptimizer)
  })

  it('module manifest depends on optimizer-core', () => {
    expect(headroomModule.manifest.id).toBe('optimizer-headroom')
    expect(headroomModule.manifest.dependsOn).toEqual({ 'optimizer-core': '^0.4.0' })
  })
})
