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
 * True for an Anthropic-shape tool-result message: a `user` message whose content
 * array carries a `tool_result` block. Duck-typed on purpose — the narrow
 * `AnthropicContentBlock` TS union doesn't declare `tool_result`, but real parsed
 * request bodies carry it regardless of the type. OpenAI never produces this shape
 * (its tool results are `role:'tool'`), so the check is a safe no-op on that lane.
 */
function isToolResultUser(m: Message): boolean {
  return (
    m.role === 'user' &&
    Array.isArray(m.content) &&
    m.content.some((p) => (p as { type?: unknown } | null)?.type === 'tool_result')
  )
}

/**
 * Split a conversation into its leading system prefix and its turns.
 *
 * A turn begins at each `user` message and runs up to (but not including) the
 * next `user` message. Two shapes are bound to the PRECEDING turn so a tool
 * round-trip is never split across the window cut:
 *  - OpenAI: `role:'tool'` responses (not `role:'user'`, so already never open a turn).
 *  - Anthropic: a `role:'user'` message carrying a `tool_result` block answers the
 *    preceding `assistant` `tool_use` message; it must stay with it, so it does NOT
 *    open a new turn.
 */
function segment(messages: Message[]): { system: Message[]; turns: Message[][] } {
  let i = 0
  while (i < messages.length && messages[i]!.role === 'system') i++
  const system = messages.slice(0, i)

  const turns: Message[][] = []
  let current: Message[] = []
  for (const m of messages.slice(i)) {
    if (m.role === 'user' && current.length > 0 && !isToolResultUser(m)) {
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
const CONDENSE_HEADER = '[Condensed earlier context]'

/**
 * Condense older turns into one text block. Both roles are kept (the thread is
 * combined, not silently dropped), but each message's text is clipped to a cap so
 * long older messages shrink. That clip is what makes the reduction real;
 * recover() restores the full originals if the step is rolled back.
 */
function condensedText(older: Message[][]): string {
  const lines = older
    .flat()
    .map((m) => {
      const text = messageText(m.content)
      const clipped = text.length > CONDENSE_CAP ? `${text.slice(0, CONDENSE_CAP)}...` : text
      return `${m.role}: ${clipped}`
    })
    .join('\n')
  return `${CONDENSE_HEADER}\n${lines}`
}

/** Prepend the condensed text onto an existing message, preserving its content shape. */
function prependCondensed(m: Message, text: string): Message {
  if (Array.isArray(m.content)) {
    return { ...m, content: [{ type: 'text', text }, ...m.content] }
  }
  return { ...m, content: `${text}\n\n${m.content}` }
}

/**
 * Splice the condensed text in front of the kept messages by MERGING it into the
 * first kept message. That message is always a genuine `user` (turn boundaries
 * only open at a non-tool_result user, and the preamble turn is never kept), so
 * merging avoids emitting two consecutive `user`-role messages — which the
 * Anthropic native passthrough lane would forward verbatim with no role-merging.
 */
function withCondensed(system: Message[], text: string, kept: Message[]): Message[] {
  const [first, ...rest] = kept
  return [...system, prependCondensed(first!, text), ...rest]
}

/** True when `current` is `original` with a condensed prefix merged in front. */
function isMergeOf(current: Message, original: Message): boolean {
  const ct = messageText(current.content)
  return ct.includes(CONDENSE_HEADER) && ct.endsWith(messageText(original.content))
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
  const newMessages = withCondensed(system, condensedText(turns.slice(0, cut)), kept)
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
    const now = readMessages(ctx.request)
    const present = new Set(now.map((m) => JSON.stringify(m)))
    for (const m of system) if (!present.has(JSON.stringify(m))) return false
    const newest = turns[turns.length - 1] ?? []
    for (let idx = 0; idx < newest.length; idx++) {
      const m = newest[idx]!
      if (present.has(JSON.stringify(m))) continue
      // window === 1 merges the condensed prefix into the newest turn's opening
      // message; tolerate that one prepend (its content survives as a suffix).
      if (idx === 0 && now.some((c) => c.role === m.role && isMergeOf(c, m))) continue
      return false
    }
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
