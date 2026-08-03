import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import { OPTIMIZER_CATALOG, type Message, type OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { contentKind, messageText, readMessages, tokensOf, writeMessages } from '../messages.js'

// ponytail: whole-message arrays only, no sub-string scanning. A tool result
// arrives as its own message; widen to embedded arrays only if real traffic
// shows them inline.

/** Header the compacted block carries, so a reader and validate() can find it. */
const TABLE_HEADER = '[Compacted JSON table]'

/** Minimum rows for this context, from the step's threshold or the catalog default. */
function minRowsOf(ctx: ProxyContext): number {
  const step = ctx.project.optimizers?.steps.find((s) => s.id === 'json-table')
  if (typeof step?.threshold === 'number' && step.threshold >= 2) return step.threshold
  return OPTIMIZER_CATALOG['json-table'].threshold!.default!
}

/** Scalar cell, or undefined when the value cannot be put in a table. */
function cell(value: unknown): string | undefined {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * Compact a uniform array of flat objects into a header line plus one line per
 * row, values separated by ` | `. Returns undefined when the array is ragged,
 * carries a nested value, is shorter than `minRows`, or contains a value that
 * would collide with the separator. Nothing is dropped: only the repeated key
 * names and JSON punctuation go.
 */
function compact(rows: unknown[], minRows: number): string | undefined {
  if (rows.length < minRows) return undefined
  const first = rows[0]
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return undefined
  const keys = Object.keys(first as Record<string, unknown>)
  if (keys.length === 0) return undefined

  const lines: string[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined
    const record = row as Record<string, unknown>
    if (Object.keys(record).length !== keys.length) return undefined
    const cells: string[] = []
    for (const key of keys) {
      if (!(key in record)) return undefined
      const value = cell(record[key])
      if (value === undefined || value.includes('|') || value.includes('\n')) return undefined
      cells.push(value)
    }
    lines.push(cells.join(' | '))
  }
  return `${TABLE_HEADER} columns: ${keys.join(' | ')}\n${lines.join('\n')}`
}

/** Compacted form of one message, or undefined when it is not a candidate. */
function compactMessage(m: Message, minRows: number): Message | undefined {
  if (typeof m.content !== 'string') return undefined
  const text = m.content.trim()
  if (contentKind(text) !== 'json') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const table = compact(parsed, minRows)
  if (table === undefined) return undefined
  if (table.length >= text.length) return undefined
  return { ...m, content: table }
}

interface Plan {
  changed: boolean
  newMessages: Message[]
}

function plan(messages: Message[], minRows: number): Plan {
  let changed = false
  const newMessages = messages.map((m) => {
    const compacted = compactMessage(m, minRows)
    if (!compacted) return m
    changed = true
    return compacted
  })
  return { changed, newMessages }
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const jsonTableOptimizer = {
  id: 'json-table',
  klass: 'recoverable',

  supports(ctx) {
    return plan(readMessages(ctx.request), minRowsOf(ctx)).changed
  },

  explain(ctx) {
    return `No message is a JSON array of at least ${minRowsOf(ctx)} uniform flat objects.`
  },

  estimate(ctx) {
    const messages = readMessages(ctx.request)
    const { newMessages } = plan(messages, minRowsOf(ctx))
    return { estimatedTokensBefore: tokensOf(messages), estimatedTokensAfter: tokensOf(newMessages) }
  },

  optimize(ctx) {
    const messages = readMessages(ctx.request)
    originals.set(ctx, messages.slice())
    const before = tokensOf(messages)
    const { changed, newMessages } = plan(messages, minRowsOf(ctx))
    if (!changed) return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    writeMessages(ctx.request, newMessages)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: tokensOf(newMessages) }
  },

  // Acceptance: message count, order and roles unchanged, and every message
  // either survived byte-identical or is a table carrying the header.
  validate(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return true
    const now = readMessages(ctx.request)
    if (now.length !== original.length) return false
    for (let i = 0; i < original.length; i++) {
      const before = original[i]!
      const after = now[i]!
      if (before.role !== after.role) return false
      const beforeText = messageText(before.content)
      const afterText = messageText(after.content)
      if (beforeText === afterText) continue
      if (!afterText.startsWith(TABLE_HEADER)) return false
    }
    return true
  },

  // core.ts has already restored ctx.request to the pre-optimize snapshot when
  // this runs; re-writing the stash in place is a defensive backstop. Safe
  // no-op when nothing was stashed.
  recover(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
} satisfies Optimizer

/**
 * optimizer-json-table module. Resolves the registry created by optimizer-core
 * and self-registers the JSON array compaction optimizer.
 */
export const jsonTableModule: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-json-table',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(jsonTableOptimizer)
  },
})
