import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { readMessages, segment, tokensOf, writeMessages } from '../messages.js'
import { listEffectiveModels } from '../../provider/list-effective.js'

// ponytail: trim-oldest to fit; no re-summarize (that is ccr's job).

// reserved completion headroom (tokens) when the step has no positive threshold
const DEFAULT_RESERVED = 1024

/** Reserved completion headroom (tokens) for this context, from the step's threshold or the default. */
function reservedOf(ctx: ProxyContext): number {
  const step = ctx.router.optimizers?.steps.find((s) => s.id === 'headroom')
  return typeof step?.threshold === 'number' && step.threshold > 0 ? step.threshold : DEFAULT_RESERVED
}

// A model-list read per proxied request would be two fs hits on the hot path,
// and supports() is synchronous so it cannot await one anyway. Same cache shape
// as observability/traces-export.ts.
// ponytail: 30s staleness is fine for a context window; a model's window changes
// when an operator edits it, not per request. Drop the TTL and invalidate from
// writeConfig only if that turns out to matter.
const WINDOWS_TTL_MS = 30_000
let windows: { at: number; byId: Map<string, number> } | null = null
let refreshing = false

/** Kick a background refresh; never awaited, never throws into the request. */
function refreshWindows(): void {
  if (refreshing) return
  refreshing = true
  void listEffectiveModels()
    .then((models) => {
      const byId = new Map<string, number>()
      for (const m of models) if ((m.contextWindow ?? 0) > 0) byId.set(m.id, m.contextWindow!)
      windows = { at: Date.now(), byId }
    })
    .catch(() => {
      // Leave the previous snapshot in place: a failed config read must not
      // silently turn a working trimmer off mid-flight.
    })
    .finally(() => {
      refreshing = false
    })
}

/** Test seam, and the way a model edit takes effect before the TTL runs out. */
export function resetContextWindowCache(): void {
  windows = null
  refreshing = false
}

/**
 * Context window of the model the client asked for, or undefined when it is
 * unknown or declares none.
 *
 * The requested model, not the attempt's: this runs in `request.preprocess`,
 * two phases before `ctx.attempt` exists. Reading `ctx.attempt` is what kept
 * this optimizer inert on every install since it shipped. A routing policy may
 * still send the request elsewhere, so the trim is sized for what the client
 * named. That can leave more history than a smaller fallback model would
 * accept; it can never trim more than the requested model needs.
 */
function contextWindowOf(ctx: ProxyContext): number | undefined {
  if (!windows || Date.now() - windows.at > WINDOWS_TTL_MS) refreshWindows()
  const requested = ctx.request.model
  if (typeof requested !== 'string' || !requested) return undefined
  return windows?.byId.get(requested)
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

  explain(ctx) {
    const contextWindow = contextWindowOf(ctx)
    if (!contextWindow) {
      return `No context window known for the requested model ${ctx.request.model || '(unnamed)'}.`
    }
    const budget = contextWindow - reservedOf(ctx)
    return `Prompt is ${tokensOf(readMessages(ctx.request))} tokens, within the ${budget}-token budget (${contextWindow} window minus ${reservedOf(ctx)} reserved).`
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
