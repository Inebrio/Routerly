import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { estimateTokens, messageText, readMessages, writeMessages } from '../messages.js'

// ponytail: exact-match dedup only; semantic/near-duplicate dedup belongs to relevance (Task 8).

/**
 * Stable key for a message. Structure-aware (the whole message, not text-only):
 * role, full content (multimodal parts, or null on tool-call turns), name,
 * tool_call_id, and tool_calls all participate. A text-only key would collapse
 * distinct image-only or tool-call messages that share/empty their text portion
 * and silently drop real content, breaking the lossless contract (and wire-format
 * transparency). JSON.stringify keeps exact-match semantics.
 */
function keyOf(m: Message): string {
  return JSON.stringify(m)
}

/**
 * Plan the dedup over a message list. For each exact-match block that repeats
 * three or more times, keep the FIRST and LAST occurrence and drop the identical
 * middle repeats. Blocks that appear once or twice are always kept.
 */
function plan(messages: Message[]): { kept: Message[]; changed: boolean } {
  const indicesByKey = new Map<string, number[]>()
  messages.forEach((m, i) => {
    const key = keyOf(m)
    const list = indicesByKey.get(key)
    if (list) list.push(i)
    else indicesByKey.set(key, [i])
  })

  const drop = new Set<number>()
  for (const idxs of indicesByKey.values()) {
    for (let k = 1; k < idxs.length - 1; k++) drop.add(idxs[k]!)
  }

  if (drop.size === 0) return { kept: messages, changed: false }
  return { kept: messages.filter((_, i) => !drop.has(i)), changed: true }
}

function tokensOf(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(messageText(m.content)), 0)
}

/** Pre-optimize unique-key set per context, read back by validate. */
const originalKeys = new WeakMap<ProxyContext, Set<string>>()

export const sessionDedupOptimizer = {
  id: 'session-dedup',
  klass: 'lossless',

  supports(ctx) {
    return readMessages(ctx.request).length > 1
  },

  estimate(ctx) {
    const messages = readMessages(ctx.request)
    const { kept } = plan(messages)
    return { estimatedTokensBefore: tokensOf(messages), estimatedTokensAfter: tokensOf(kept) }
  },

  optimize(ctx) {
    const messages = readMessages(ctx.request)
    originalKeys.set(ctx, new Set(messages.map(keyOf)))
    const { kept, changed } = plan(messages)
    const before = tokensOf(messages)
    if (!changed) return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    writeMessages(ctx.request, kept)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: tokensOf(kept) }
  },

  // Lossless invariant: message count only shrank and every unique message
  // (by structure-aware key) present before is still present (no content lost).
  validate(ctx, result: OptimizerResult) {
    if (result.estimatedTokensAfter > result.estimatedTokensBefore) return false
    const before = originalKeys.get(ctx)
    if (!before) return true
    const after = new Set(readMessages(ctx.request).map(keyOf))
    if (after.size !== before.size) return false
    for (const key of before) if (!after.has(key)) return false
    return true
  },
} satisfies Optimizer

/**
 * optimizer-session-dedup module. Resolves the registry created by
 * optimizer-core and self-registers the session-dedup optimizer.
 */
export const sessionDedupModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-session-dedup',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(sessionDedupOptimizer)
  },
})
