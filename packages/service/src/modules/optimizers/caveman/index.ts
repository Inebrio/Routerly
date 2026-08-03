import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { messageText, readMessages, tokensOf, writeMessages } from '../messages.js'

// ponytail: rule-based lexical strip; no model.
//
// CLEAN-ROOM: the stopword/filler list below is written from scratch for this
// codebase. No external code, dataset, or third-party wordlist was copied or
// adapted. See ../README.md#caveman.

/**
 * Clean-room function-word / filler list. Deliberately small and English-only:
 * high-frequency articles, conjunctions, prepositions, pronouns, auxiliaries,
 * and hedges that carry little standalone signal. Nouns, verbs of substance,
 * and every non-listed token are kept.
 *
 * English-only is a property, not a limitation to fix here. Growing this into
 * one list per language does not scale and is not how the problem is solved:
 * `llmlingua-2` compresses any language its multilingual encoder covers. This
 * optimizer is the zero-dependency English fallback, and englishRatio() below
 * keeps it out of every other language.
 */
const STOPWORDS = new Set<string>([
  // articles / determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // conjunctions
  'and', 'or', 'but', 'nor', 'so', 'yet', 'as', 'than', 'then',
  // prepositions
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'into', 'onto',
  'about', 'over', 'under', 'via',
  // pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  // auxiliaries / copulas
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'shall',
  'may', 'might', 'must',
  // fillers / hedges
  'just', 'very', 'really', 'actually', 'basically', 'simply', 'literally',
  'please', 'kindly',
])

/**
 * Below this fraction of words drawn from STOPWORDS, the text is not English and
 * this optimizer would strip words that merely look like English function words.
 * Measured on the analysis corpus: English 0.46, Italian 0.026. Anything in
 * between is a wide, empty margin.
 */
const MIN_ENGLISH_RATIO = 0.12

/** Minimum word count before the ratio means anything. */
const MIN_WORDS_TO_JUDGE = 20

/**
 * Fraction of words that are English function words. Counts every Unicode letter
 * run in the denominator, so accented words count as words and a non-English
 * text is not flattered by its own spelling. Short texts return 1: the ratio is
 * noise there, and a strip that short is bounded anyway.
 */
function englishRatio(messages: Message[]): number {
  const words = messages.flatMap((m) => messageText(m.content).toLowerCase().match(/\p{L}+/gu) ?? [])
  if (words.length < MIN_WORDS_TO_JUDGE) return 1
  return words.filter((w) => STOPWORDS.has(w)).length / words.length
}

/**
 * Verbatim-preservation spans, matched greedily in this priority order:
 *  1. fenced code block (``` ... ```) — whole block, inner filler untouched
 *  2. inline code span (` ... `)
 *  3. URL (http/https)
 *  4. compound token: two or more word runs joined by `/`, `.` or `-` with no
 *     surrounding space. That is what a file path, a dotted identifier and a
 *     hyphenated compound all look like. Without it the strip ate the word runs
 *     that happened to be stopwords and turned docs/concepts/on-call.md into
 *     docs/concepts/-call.md, silently, since validate() reads this same regex
 *     to decide what had to survive.
 * Wrapped in a single capture group so `String.split` returns the spans
 * interleaved with the plain text between them.
 */
const PROTECTED = /(```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|[A-Za-z0-9_]+(?:[./-][A-Za-z0-9_]+)+)/g

/**
 * Strip stopwords from a plain (unprotected) text segment and collapse the
 * whitespace the removals leave behind. Only fully-alphabetic words are
 * candidates: any token carrying a digit (e.g. `v2`, `42`, `007`) is never
 * matched, so digit sequences survive byte-for-byte. Segment edges are NOT
 * trimmed here — a boundary space kept next to a protected span is what stops
 * a word gluing onto adjacent code/URL; the assembled message text is trimmed
 * once at the end.
 */
function stripPlain(text: string): string {
  return text
    .replace(/\b[A-Za-z]+\b/g, (w) => (STOPWORDS.has(w.toLowerCase()) ? '' : w))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Lexically compress a text string: strip stopwords/filler from the plain
 * regions while leaving fenced code, inline code, and URLs byte-for-byte
 * intact. Even-index split parts are plain text, odd-index parts are protected.
 */
function stripText(text: string): string {
  const parts = text.split(PROTECTED)
  return parts.map((p, i) => (i % 2 === 0 ? stripPlain(p) : p)).join('').trim()
}

/**
 * Rewrite a message's own text in place (structurally): string content is
 * stripped directly; array content only has its `type: 'text'` parts stripped
 * — every other part (image_url, tool_use, tool_result, ...) is left
 * byte-identical. Messages are never dropped, reordered, or merged.
 */
function stripMessage(m: Message): { message: Message; changed: boolean } {
  if (typeof m.content === 'string') {
    const text = stripText(m.content)
    if (text === m.content) return { message: m, changed: false }
    return { message: { ...m, content: text }, changed: true }
  }
  if (Array.isArray(m.content)) {
    let changed = false
    const content = m.content.map((p) => {
      if (p.type === 'text' && typeof p.text === 'string') {
        const text = stripText(p.text)
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

interface Plan {
  changed: boolean
  newMessages: Message[]
}

function plan(messages: Message[]): Plan {
  let changed = false
  const newMessages = messages.map((m) => {
    const r = stripMessage(m)
    if (r.changed) changed = true
    return r.message
  })
  return { changed, newMessages }
}

/** Substrings that MUST survive a strip verbatim: protected spans + digit runs. */
function mustSurvive(text: string): string[] {
  return [...(text.match(PROTECTED) ?? []), ...(text.match(/\d+/g) ?? [])]
}

/** Non-text content parts and text-preservation check for one message pair. */
function messagePreserved(before: Message, after: Message): boolean {
  if (before.role !== after.role) return false
  const ba = Array.isArray(before.content)
  const aa = Array.isArray(after.content)
  if (ba !== aa) return false
  if (ba && aa) {
    const beforeParts = before.content as unknown[]
    if (beforeParts.length !== (after.content as unknown[]).length) return false
    for (let j = 0; j < beforeParts.length; j++) {
      const op = beforeParts[j] as { type?: unknown; text?: unknown } | null
      const np = (after.content as unknown[])[j] as { type?: unknown; text?: unknown } | null
      if (op && op.type === 'text') {
        if (!np || np.type !== 'text') return false
        const b = String(op.text ?? '')
        const a = String(np.text ?? '')
        if (!mustSurvive(b).every((s) => a.includes(s))) return false
      } else if (JSON.stringify(op) !== JSON.stringify(np)) {
        return false
      }
    }
    return true
  }
  const b = messageText(before.content)
  const a = messageText(after.content)
  return mustSurvive(b).every((s) => a.includes(s))
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const cavemanOptimizer = {
  id: 'caveman',
  klass: 'lossy',

  supports(ctx) {
    const messages = readMessages(ctx.request)
    if (englishRatio(messages) < MIN_ENGLISH_RATIO) return false
    return plan(messages).changed
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

  // Acceptance backstop (runs in addition to the lossy safety gate in
  // core.ts/gate.ts): message count/order/roles unchanged, non-text content
  // parts byte-identical, and every protected span (fenced code, inline code,
  // URL) plus every digit run present before the strip still appears verbatim
  // after it. Safe pass when nothing was stashed.
  validate(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return true
    const now = readMessages(ctx.request)
    if (now.length !== original.length) return false
    for (let i = 0; i < original.length; i++) {
      if (!messagePreserved(original[i]!, now[i]!)) return false
    }
    return true
  },

  // core.ts's applyProcessor calls recover() on any validate()===false or a
  // failed lossy safety gate. ctx.request has already been restored to the
  // pre-optimize snapshot by then; this re-writes the stash in place as a
  // defensive backstop. Safe no-op when nothing was stashed.
  recover(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
} satisfies Optimizer

/**
 * optimizer-caveman module. Resolves the registry created by optimizer-core and
 * self-registers the caveman lexical-compression optimizer.
 */
export const cavemanModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-caveman',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(cavemanOptimizer)
  },
})
