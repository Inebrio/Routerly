import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import { OPTIMIZER_CATALOG, type Message, type OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { messageText, readMessages, segment, tokensOf, writeMessages } from '../messages.js'

// ponytail: lexical-overlap score; upgrade to embeddings only if lexical proves too blunt.

/**
 * Relevance threshold for this context, from the step's `threshold` or the
 * catalog default. Enabling the step in a surface is the opt-in; requiring a
 * second, undiscoverable number on top of it just made the optimizer silently
 * inert for anyone who enabled it and saved.
 */
function thresholdOf(ctx: ProxyContext): number {
  const step = ctx.router.optimizers?.steps.find((s) => s.id === 'relevance')
  if (typeof step?.threshold === 'number') return step.threshold
  return OPTIMIZER_CATALOG.relevance.threshold!.default!
}

/** Lowercased, non-alphanumeric-split word set of a turn's combined text. */
function wordsOf(turn: Message[]): Set<string> {
  const text = turn.map((m) => messageText(m.content)).join(' ')
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean))
}

/** Jaccard similarity of two word sets; 0 when both are empty (not relevant, not NaN). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

interface Plan {
  changed: boolean
  newMessages: Message[]
  before: number
  after: number
}

/**
 * Score each older turn's lexical overlap against the newest turn; drop the
 * whole turn when it scores below `threshold`. The newest turn is never
 * scored against itself and is always kept.
 */
function plan(messages: Message[], threshold: number): Plan {
  const { system, turns } = segment(messages)
  const before = tokensOf(messages)
  if (turns.length <= 1) {
    return { changed: false, newMessages: messages, before, after: before }
  }
  const newest = turns[turns.length - 1]!
  const newestWords = wordsOf(newest)
  const older = turns.slice(0, -1)
  const kept = older.filter((t) => jaccard(wordsOf(t), newestWords) >= threshold)
  if (kept.length === older.length) {
    return { changed: false, newMessages: messages, before, after: before }
  }
  const newMessages = [...system, ...kept.flat(), ...newest]
  return { changed: true, newMessages, before, after: tokensOf(newMessages) }
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const relevanceOptimizer = {
  id: 'relevance',
  klass: 'lossy',

  supports(ctx) {
    return segment(readMessages(ctx.request)).turns.length > 1
  },

  explain() {
    return 'Only one turn: there is no older history to score against the newest one.'
  },

  estimate(ctx) {
    const { before, after } = plan(readMessages(ctx.request), thresholdOf(ctx))
    return { estimatedTokensBefore: before, estimatedTokensAfter: after }
  },

  optimize(ctx) {
    const messages = readMessages(ctx.request)
    originals.set(ctx, messages.slice())
    const { changed, newMessages, before, after } = plan(messages, thresholdOf(ctx))
    if (!changed) return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    writeMessages(ctx.request, newMessages)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: after }
  },

  // Acceptance: the leading system prefix (if any) and the newest turn survive
  // intact in ctx.request. This runs in addition to the lossy safety gate
  // (see core.ts / gate.ts) as its own backstop.
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

  // core.ts's applyProcessor calls recover() on rollback whenever the lossy
  // safety gate rejects the result OR validate() returns false. ctx.request
  // has already been restored to the pre-optimize snapshot by then; this is a
  // defensive re-write in place. Safe no-op when nothing was stashed.
  recover(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
} satisfies Optimizer

/**
 * optimizer-relevance module. Resolves the registry created by optimizer-core
 * and self-registers the relevance lexical-overlap optimizer.
 */
export const relevanceModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-relevance',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(relevanceOptimizer)
  },
})
