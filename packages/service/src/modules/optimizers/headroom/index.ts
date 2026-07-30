import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { readMessages, segment, tokensOf, writeMessages } from '../messages.js'

// ponytail: trim-oldest to fit; no re-summarize (that is ccr's job).

// reserved completion headroom (tokens) when the step has no positive threshold
const DEFAULT_RESERVED = 1024

/** Reserved completion headroom (tokens) for this context, from the step's threshold or the default. */
function reservedOf(ctx: ProxyContext): number {
  const step = ctx.project.optimizers?.steps.find((s) => s.id === 'headroom')
  return typeof step?.threshold === 'number' && step.threshold > 0 ? step.threshold : DEFAULT_RESERVED
}

/**
 * Target model's context window for this attempt, or undefined when not yet
 * known — no candidate resolved yet, or the model config doesn't declare one.
 */
function contextWindowOf(ctx: ProxyContext): number | undefined {
  return ctx.attempt?.model?.contextWindow || undefined
}

interface Plan {
  changed: boolean
  newMessages: Message[]
  before: number
  after: number
}

/**
 * Drop the oldest turns, each in full (never split a turn), until the prompt
 * fits `budget` or only the newest turn remains — whichever comes first.
 */
function plan(messages: Message[], budget: number): Plan {
  const { system, turns } = segment(messages)
  const before = tokensOf(messages)
  let remaining = turns
  while (remaining.length > 1 && tokensOf([...system, ...remaining.flat()]) > budget) {
    remaining = remaining.slice(1)
  }
  if (remaining.length === turns.length) {
    return { changed: false, newMessages: messages, before, after: before }
  }
  const newMessages = [...system, ...remaining.flat()]
  return { changed: true, newMessages, before, after: tokensOf(newMessages) }
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const headroomOptimizer = {
  id: 'headroom',
  klass: 'lossless',

  supports(ctx) {
    const contextWindow = contextWindowOf(ctx)
    if (!contextWindow) return false
    return tokensOf(readMessages(ctx.request)) > contextWindow - reservedOf(ctx)
  },

  estimate(ctx) {
    const contextWindow = contextWindowOf(ctx)
    const messages = readMessages(ctx.request)
    if (!contextWindow) {
      const before = tokensOf(messages)
      return { estimatedTokensBefore: before, estimatedTokensAfter: before }
    }
    const { before, after } = plan(messages, contextWindow - reservedOf(ctx))
    return { estimatedTokensBefore: before, estimatedTokensAfter: after }
  },

  optimize(ctx) {
    const messages = readMessages(ctx.request)
    originals.set(ctx, messages.slice())
    const contextWindow = contextWindowOf(ctx)
    const budget = (contextWindow ?? Infinity) - reservedOf(ctx)
    const { changed, newMessages, before, after } = plan(messages, budget)
    if (!changed) return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    writeMessages(ctx.request, newMessages)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: after }
  },

  // Acceptance: the leading system prefix (if any) and the newest turn survive
  // intact in ctx.request. `lossless` skips the lossy safety gate (see core.ts),
  // so this validate is the only backstop — it must never pass a request that
  // lost the system prefix or the newest turn.
  validate(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return true
    const { system, turns } = segment(original)
    const now = readMessages(ctx.request)
    const present = new Set(now.map((m) => JSON.stringify(m)))
    for (const m of system) if (!present.has(JSON.stringify(m))) return false
    const newest = turns[turns.length - 1] ?? []
    for (const m of newest) if (!present.has(JSON.stringify(m))) return false
    return true
  },

  // core.ts's applyProcessor calls recover() on rollback whenever validate()
  // returns false — regardless of klass, not only for `recoverable` — so this IS
  // meaningfully callable for a lossless optimizer too. ctx.request has already
  // been restored to the pre-optimize snapshot by then; this is a defensive
  // re-write in place. Safe no-op when nothing was stashed.
  recover(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
} satisfies Optimizer

/**
 * optimizer-headroom module. Resolves the registry created by optimizer-core
 * and self-registers the headroom context-window-fit optimizer.
 */
export const headroomModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-headroom',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(headroomOptimizer)
  },
})
