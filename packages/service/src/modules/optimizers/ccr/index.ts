import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { estimateTokens, messageText, readMessages, writeMessages } from '../messages.js'

// ponytail: window-keep reduction, no LLM summarizer call; add a summarizer model only if window-keep loses needed context.

// keep last 6 turns by default
const DEFAULT_WINDOW = 6

/**
 * Split a conversation into its leading system prefix and its turns.
 *
 * A turn begins at each `user` message and runs up to (but not including) the
 * next `user` message. This makes tool round-trips atomic: an assistant message
 * carrying tool_calls and the tool-role message(s) answering it always land in
 * the same segment (they never span a user boundary), so a turn is never split
 * in a way that would orphan a tool response from its call.
 */
function segment(messages: Message[]): { system: Message[]; turns: Message[][] } {
  let i = 0
  while (i < messages.length && messages[i]!.role === 'system') i++
  const system = messages.slice(0, i)

  const turns: Message[][] = []
  let current: Message[] = []
  for (const m of messages.slice(i)) {
    if (m.role === 'user' && current.length > 0) {
      turns.push(current)
      current = []
    }
    current.push(m)
  }
  if (current.length > 0) turns.push(current)

  return { system, turns }
}

/** N (turns to keep) for this context, from the step's threshold or the default. */
function windowOf(ctx: ProxyContext): number {
  const step = ctx.project.optimizers?.steps.find((s) => s.id === 'ccr')
  return typeof step?.threshold === 'number' && step.threshold > 0 ? step.threshold : DEFAULT_WINDOW
}

// ponytail: fixed per-message truncation cap; the reduction comes from clipping
// long older messages, not summarizing. Raise/lower only if window-keep clips too
// much or too little context in practice.
const CONDENSE_CAP = 200

/**
 * Collapse older turns into a single condensed context message. Both roles are
 * kept (the thread is combined, not silently dropped), but each message's text is
 * clipped to a cap so long older messages shrink. That clip is what makes the
 * reduction real; recover() restores the full originals if the step is rolled back.
 */
function condense(older: Message[][]): Message {
  const lines = older
    .flat()
    .map((m) => {
      const text = messageText(m.content)
      const clipped = text.length > CONDENSE_CAP ? `${text.slice(0, CONDENSE_CAP)}...` : text
      return `${m.role}: ${clipped}`
    })
    .join('\n')
  return { role: 'user', content: `[Condensed earlier context]\n${lines}` }
}

function tokensOf(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(messageText(m.content)), 0)
}

interface Plan {
  changed: boolean
  newMessages: Message[]
  before: number
  after: number
}

function plan(messages: Message[], window: number): Plan {
  const { system, turns } = segment(messages)
  const before = tokensOf(messages)
  if (turns.length <= window) {
    return { changed: false, newMessages: messages, before, after: before }
  }
  const cut = turns.length - window
  const kept = turns.slice(cut).flat()
  const newMessages = [...system, condense(turns.slice(0, cut)), ...kept]
  return { changed: true, newMessages, before, after: tokensOf(newMessages) }
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const ccrOptimizer: Optimizer = {
  id: 'ccr',
  klass: 'recoverable',

  supports(ctx) {
    return segment(readMessages(ctx.request)).turns.length > windowOf(ctx)
  },

  estimate(ctx) {
    const { before, after } = plan(readMessages(ctx.request), windowOf(ctx))
    return { estimatedTokensBefore: before, estimatedTokensAfter: after }
  },

  optimize(ctx) {
    const messages = readMessages(ctx.request)
    originals.set(ctx, messages.slice())
    const { changed, newMessages, before, after } = plan(messages, windowOf(ctx))
    if (!changed) return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    writeMessages(ctx.request, newMessages)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: after }
  },

  // Acceptance: the leading system prefix (if any) and the newest turn survive
  // intact in ctx.request. Not a token-shrink check.
  validate(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return true
    const { system, turns } = segment(original)
    const present = new Set(readMessages(ctx.request).map((m) => JSON.stringify(m)))
    const required = [...system, ...(turns[turns.length - 1] ?? [])]
    for (const m of required) if (!present.has(JSON.stringify(m))) return false
    return true
  },

  // Core has already restored ctx.request to the pre-optimize snapshot before this
  // runs; re-write the stashed originals in place as a defensive confirmation.
  // Safe no-op when no stash exists (mirrors session-dedup's "no stash" default).
  recover(ctx) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
}

/**
 * optimizer-ccr module. Resolves the registry created by optimizer-core and
 * self-registers the ccr context-reduction optimizer.
 */
export const ccrModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-ccr',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(ccrOptimizer)
  },
})
