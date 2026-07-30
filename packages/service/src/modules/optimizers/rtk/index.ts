import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { estimateTokens, readMessages, writeMessages } from '../messages.js'

// ponytail: clean-room rule-based whitespace/boilerplate compaction, no summarizer
// call and no external technique reused — see ../README.md#rtk.

/**
 * Collapse redundant whitespace: runs of spaces/tabs to one space, spaces
 * trimmed around newlines, and runs of 3+ newlines (2+ blank lines) to a
 * single blank line.
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ponytail: only blocks at least this long are eligible for boilerplate dedup —
// short repeats (e.g. a user saying "ok" twice) are real content, not scaffolding.
// Raise/lower only if real boilerplate slips through or real content gets stripped.
const MIN_BOILERPLATE_LEN = 40

/** Unique, non-empty paragraph blocks (split on blank lines), trimmed. */
function uniqueBlocks(text: string): Set<string> {
  const out = new Set<string>()
  for (const b of text.split(/\n{2,}/)) {
    const t = b.trim()
    if (t.length > 0) out.add(t)
  }
  return out
}

/**
 * Strip repeated boilerplate/scaffolding paragraph blocks within a single
 * message, keeping the FIRST occurrence of each. Blocks shorter than
 * MIN_BOILERPLATE_LEN are always kept (never deduped) so short, legitimately
 * repeated content is never dropped.
 */
function stripDuplicateBlocks(text: string): string {
  const blocks = text.split(/\n{2,}/)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const b of blocks) {
    const key = b.trim()
    if (key.length >= MIN_BOILERPLATE_LEN) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    kept.push(b)
  }
  return kept.join('\n\n')
}

function compactText(text: string): string {
  return collapseWhitespace(stripDuplicateBlocks(text))
}

/**
 * Compact a message's content in place (structurally): string content is
 * compacted directly; array content only has its `type: 'text'` parts
 * compacted, text-in-place — every other part (image_url, tool_use,
 * tool_result, ...) is left byte-identical and untouched. Messages are never
 * dropped, reordered, or merged; only the density of their own text changes.
 */
function compactMessage(m: Message): { message: Message; changed: boolean } {
  if (typeof m.content === 'string') {
    const text = compactText(m.content)
    if (text === m.content) return { message: m, changed: false }
    return { message: { ...m, content: text }, changed: true }
  }
  if (Array.isArray(m.content)) {
    let changed = false
    const content = m.content.map((p) => {
      if (p.type === 'text' && typeof p.text === 'string') {
        const text = compactText(p.text)
        if (text !== p.text) {
          changed = true
          return { ...p, text }
        }
      }
      return p
    })
    if (!changed) return { message: m, changed: false }
    return { message: { ...m, content }, changed: true }
  }
  return { message: m, changed: false }
}

function tokensOf(messages: Message[]): number {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + estimateTokens(text)
  }, 0)
}

interface Plan {
  changed: boolean
  newMessages: Message[]
}

function plan(messages: Message[]): Plan {
  let changed = false
  const newMessages = messages.map((m) => {
    const r = compactMessage(m)
    if (r.changed) changed = true
    return r.message
  })
  return { changed, newMessages }
}

/** Content of a single message, string or array-of-parts, for validate comparison. */
function contentText(content: Message['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

/** Every unique semantic block of `before` survives (whitespace-normalized) in `after`. */
function blocksSurvive(before: string, after: string): boolean {
  const after$ = collapseWhitespace(after)
  for (const block of uniqueBlocks(before)) {
    if (!after$.includes(collapseWhitespace(block))) return false
  }
  return true
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const rtkOptimizer: Optimizer = {
  id: 'rtk',
  klass: 'recoverable',

  supports(ctx) {
    return plan(readMessages(ctx.request)).changed
  },

  estimate(ctx) {
    const messages = readMessages(ctx.request)
    const { newMessages } = plan(messages)
    return { estimatedTokensBefore: tokensOf(messages), estimatedTokensAfter: tokensOf(newMessages) }
  },

  optimize(ctx) {
    const messages = readMessages(ctx.request)
    originals.set(ctx, messages.slice())
    const before = tokensOf(messages)
    const { changed, newMessages } = plan(messages)
    if (!changed) return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    writeMessages(ctx.request, newMessages)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: tokensOf(newMessages) }
  },

  // Acceptance: message count/order/roles unchanged, non-text content parts
  // byte-identical, and every unique semantic text block present before
  // compaction still appears (whitespace-normalized) in the current message.
  // Not a strict lossless check — intentionally deduped boilerplate blocks are
  // expected to appear only once, which is exactly what "markers survive" means
  // for a compaction pass.
  validate(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return true
    const now = readMessages(ctx.request)
    if (now.length !== original.length) return false
    for (let i = 0; i < original.length; i++) {
      const om = original[i]!
      const nm = now[i]!
      if (om.role !== nm.role) return false
      if (Array.isArray(om.content) !== Array.isArray(nm.content)) return false
      if (Array.isArray(om.content) && Array.isArray(nm.content)) {
        if (om.content.length !== nm.content.length) return false
        for (let j = 0; j < om.content.length; j++) {
          const op = om.content[j] as { type?: unknown; text?: unknown } | null
          const np = nm.content[j] as { type?: unknown; text?: unknown } | null
          if (op && op.type === 'text') {
            if (!np || np.type !== 'text') return false
            if (!blocksSurvive(String(op.text ?? ''), String(np.text ?? ''))) return false
          } else if (JSON.stringify(op) !== JSON.stringify(np)) {
            return false
          }
        }
      } else if (!blocksSurvive(contentText(om.content), contentText(nm.content))) {
        return false
      }
    }
    return true
  },

  // Core has already restored ctx.request to the pre-optimize snapshot before
  // this runs; re-write the stashed originals in place as a defensive
  // confirmation. Safe no-op when no stash exists.
  recover(ctx) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
}

/**
 * optimizer-rtk module. Resolves the registry created by optimizer-core and
 * self-registers the rtk token-compaction optimizer.
 */
export const rtkModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-rtk',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(rtkOptimizer)
  },
})
