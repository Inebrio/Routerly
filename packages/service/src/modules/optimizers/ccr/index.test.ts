import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import type { ChatCompletionRequest, Message, OptimizerStep } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages } from '../messages.js'
import { optimizerCoreModule } from '../core.js'
import { ccrModule, ccrOptimizer } from './index.js'

function ctxWith(messages: Message[], threshold?: number): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  const steps: OptimizerStep[] =
    threshold === undefined ? [] : [{ id: 'ccr', enabled: true, threshold }]
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
  } as ProxyContext
}

/**
 * Build a system message plus `n` user+assistant turns (q1/a1, q2/a2, ...).
 * `answerLen` pads each assistant answer so older-turn clipping yields a real
 * token reduction (the condensation caps long messages).
 */
function conversation(n: number, withSystem = true, answerLen = 0): Message[] {
  const msgs: Message[] = []
  if (withSystem) msgs.push({ role: 'system', content: 'You are a helpful agent.' })
  for (let i = 1; i <= n; i++) {
    const answer = answerLen > 0 ? `a${i} ${'x'.repeat(answerLen)}` : `a${i}`
    msgs.push({ role: 'user', content: `q${i}` })
    msgs.push({ role: 'assistant', content: answer })
  }
  return msgs
}

describe('ccr optimizer', () => {
  it('is recoverable with the ccr id', () => {
    expect(ccrOptimizer.id).toBe('ccr')
    expect(ccrOptimizer.klass).toBe('recoverable')
  })

  it('keeps the system message and the last N turns, collapsing older ones', () => {
    // 10 turns, threshold 6 -> collapse the 4 oldest into one condensed message.
    // Long assistant answers make the clip yield a real token reduction.
    const ctx = ctxWith(conversation(10, true, 400), 6)
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)

    const msgs = readMessages(ctx.request)
    // system + 6 kept turns (2 msgs each); the condensed text is MERGED into the
    // first kept user message (not a separate entry) = 13
    expect(msgs).toHaveLength(1 + 6 * 2)
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are a helpful agent.' })
    // condensed context merged into the first kept user message; references dropped turns
    expect(msgs[1]!.role).toBe('user')
    expect(msgs[1]!.content).toContain('[Condensed earlier context]')
    expect(msgs[1]!.content).toContain('q1')
    expect(msgs[1]!.content).toContain('a4')
    // newest turn retained verbatim at the tail (long answer NOT clipped)
    expect(msgs[msgs.length - 2]).toEqual({ role: 'user', content: 'q10' })
    expect(msgs[msgs.length - 1]!.role).toBe('assistant')
    expect(msgs[msgs.length - 1]!.content).toBe(conversation(10, true, 400).at(-1)!.content)
    // in-place mutation keeps request/original identity
    expect(ctx.request).toBe(ctx.original)
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore)
    expect(ccrOptimizer.validate(ctx, result)).toBe(true)
  })

  it('uses the default window of 6 turns when no threshold is configured', () => {
    const ctx = ctxWith(conversation(8)) // no threshold -> default 6
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const msgs = readMessages(ctx.request)
    // system + 6 kept turns (condensed merged into the first kept user message)
    expect(msgs).toHaveLength(1 + 6 * 2)
    expect(msgs[msgs.length - 1]).toEqual({ role: 'assistant', content: 'a8' })
  })

  it('leaves a conversation within the window untouched', () => {
    const ctx = ctxWith(conversation(6), 6) // exactly N turns -> nothing to reduce
    const before = readMessages(ctx.request).slice()
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual(before)
    expect(ccrOptimizer.validate(ctx, result)).toBe(true)
  })

  it('supports is false within the window, true beyond it', () => {
    expect(ccrOptimizer.supports(ctxWith(conversation(6), 6))).toBe(false)
    expect(ccrOptimizer.supports(ctxWith(conversation(7), 6))).toBe(true)
  })

  it('works without a system message', () => {
    const ctx = ctxWith(conversation(8, false), 6)
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const msgs = readMessages(ctx.request)
    // 6 kept turns, no system; condensed merged into the first kept user message
    expect(msgs).toHaveLength(6 * 2)
    expect(msgs[0]!.role).toBe('user')
    expect(msgs[0]!.content).toContain('[Condensed earlier context]')
    expect(ccrOptimizer.validate(ctx, result)).toBe(true)
  })

  it('keeps an OpenAI tool-call/tool-response group atomic within a turn', () => {
    // OpenAI tool results are role:'tool', which never open a turn; the whole
    // round-trip stays in one segment and is never split.
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      // tool round-trip inside turn 3
      { role: 'assistant', content: '', name: 'call' },
      { role: 'tool', content: 'tool-out', tool_call_id: 'c1' },
      { role: 'assistant', content: 'a3' },
    ]
    const ctx = ctxWith(msgs, 2) // keep the last two turns; turn-3 group stays intact
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const out = readMessages(ctx.request)
    // the whole turn-3 group (4 messages) survives verbatim at the tail
    const tail = out.slice(out.length - 4)
    expect(tail).toEqual([
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: '', name: 'call' },
      { role: 'tool', content: 'tool-out', tool_call_id: 'c1' },
      { role: 'assistant', content: 'a3' },
    ])
    expect(ccrOptimizer.validate(ctx, result)).toBe(true)
  })

  it('keeps an Anthropic tool_use / tool_result pair on the same side of the window cut', () => {
    // Anthropic tool results are role:'user' with a tool_result content block; they
    // must NOT open a new turn, or the window cut could orphan the tool_result from
    // its assistant tool_use (Anthropic then 400s on a tool_result with no tool_use).
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
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      // newest turn opens with an array-content user message (Anthropic shape)
      { role: 'user', content: [{ type: 'text', text: 'u3' }] } as unknown as Message,
      toolUse,
      toolResult, // binds to the newest turn, does NOT open a new one
      { role: 'assistant', content: 'a3' },
    ]
    const ctx = ctxWith(msgs, 1) // keep only the newest turn
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const out = readMessages(ctx.request)
    // both tool messages survive together; the pair is adjacent and intact
    expect(out).toContainEqual(toolUse)
    expect(out).toContainEqual(toolResult)
    const iUse = out.findIndex((m) => m === toolUse)
    expect(out[iUse + 1]).toBe(toolResult)
    expect(ccrOptimizer.validate(ctx, result)).toBe(true)
  })

  it('never emits two consecutive same-role messages (condensed merged, not inserted)', () => {
    const ctx = ctxWith(conversation(10, true, 400), 6)
    ccrOptimizer.optimize(ctx)
    const out = readMessages(ctx.request)
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.role).not.toBe(out[i - 1]!.role)
    }
    // condensed text lives inside the first kept user message, not a separate one
    const firstUser = out.find((m) => m.role === 'user')!
    expect(firstUser.content as string).toContain('[Condensed earlier context]')
  })

  it('treats a non-positive threshold as the default window', () => {
    expect(ccrOptimizer.supports(ctxWith(conversation(6), 0))).toBe(false)
    expect(ccrOptimizer.supports(ctxWith(conversation(7), 0))).toBe(true)
  })

  it('recover restores the original messages when explicitly invoked', () => {
    const ctx = ctxWith(conversation(10), 6)
    const original = readMessages(ctx.request).slice()
    ccrOptimizer.optimize(ctx)
    expect(readMessages(ctx.request).length).toBeLessThan(original.length)
    // core would have restored ctx.request already; recover is a defensive re-write.
    ctx.request.messages = [{ role: 'user', content: 'garbage' }]
    ccrOptimizer.recover!(ctx, {
      changed: true,
      estimatedTokensBefore: 0,
      estimatedTokensAfter: 0,
    })
    expect(readMessages(ctx.request)).toEqual(original)
    expect(ctx.request).toBe(ctx.original)
  })

  it('recover is a safe no-op when nothing was stashed', () => {
    const ctx = ctxWith(conversation(3), 6)
    const before = readMessages(ctx.request).slice()
    expect(() =>
      ccrOptimizer.recover!(ctx, {
        changed: false,
        estimatedTokensBefore: 0,
        estimatedTokensAfter: 0,
      }),
    ).not.toThrow()
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('validate fails when the newest turn was lost', () => {
    const ctx = ctxWith(conversation(10), 6)
    const result = ccrOptimizer.optimize(ctx)
    // drop the newest turn from the post-state
    ctx.request.messages = readMessages(ctx.request).slice(0, -2)
    expect(ccrOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate fails when the system message was lost', () => {
    const ctx = ctxWith(conversation(10), 6)
    const result = ccrOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).filter((m) => m.role !== 'system')
    expect(ccrOptimizer.validate(ctx, result)).toBe(false)
  })

  it('handles a system-only conversation (no turns) as a no-op', () => {
    const ctx = ctxWith([{ role: 'system', content: 'sys-only' }], 6)
    expect(ccrOptimizer.supports(ctx)).toBe(false)
    const result = ccrOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(ccrOptimizer.validate(ctx, result)).toBe(true)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith(conversation(3), 6)
    expect(
      ccrOptimizer.validate(ctx, {
        changed: false,
        estimatedTokensBefore: 1,
        estimatedTokensAfter: 1,
      }),
    ).toBe(true)
  })

  it('estimate previews the reduction without mutating', () => {
    const ctx = ctxWith(conversation(10, true, 400), 6)
    const est = ccrOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBeLessThan(est.estimatedTokensBefore)
    expect(readMessages(ctx.request)).toHaveLength(1 + 10 * 2) // untouched
  })

  it('estimate reports no change within the window', () => {
    const ctx = ctxWith(conversation(4), 6)
    const est = ccrOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBe(est.estimatedTokensBefore)
  })

  it('registers into OPTIMIZER_REGISTRY via its module', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await ccrModule.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('ccr')).toBe(ccrOptimizer)
  })

  it('module manifest depends on optimizer-core', () => {
    expect(ccrModule.manifest.id).toBe('optimizer-ccr')
    expect(ccrModule.manifest.dependsOn).toEqual({ 'optimizer-core': '^0.4.0' })
  })
})
