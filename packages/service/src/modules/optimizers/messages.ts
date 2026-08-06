import type { ChatCompletionRequest, Message } from '@routerly/shared'

// Reuse the canonical string|content-block flattener from the reverse-proxy
// helpers; optimizer submodules extract message text through this single source.
import { messageText } from '../reverse-proxy/helpers.js'
export { messageText } from '../reverse-proxy/helpers.js'

/** Current messages of a request (the canonical OpenAI view). */
export function readMessages(req: ChatCompletionRequest): Message[] {
  return req.messages ?? []
}

/**
 * Replace a request's messages IN PLACE. Mutating `req.messages` (not
 * reassigning `req`) is what keeps the Anthropic lane in sync, since
 * `ctx.request` and `ctx.original` are the same object. See core.ts.
 */
export function writeMessages(req: ChatCompletionRequest, msgs: Message[]): void {
  req.messages = msgs
}

/**
 * Cheap token estimate.
 * ponytail: chars/4 token estimate; swap for tiktoken only if preview accuracy
 * is challenged.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * True for an Anthropic-shape tool-result message: a `user` message whose content
 * array carries a `tool_result` block. Duck-typed on purpose — the narrow
 * `AnthropicContentBlock` TS union doesn't declare `tool_result`, but real parsed
 * request bodies carry it regardless of the type. OpenAI never produces this shape
 * (its tool results are `role:'tool'`), so the check is a safe no-op on that lane.
 */
export function isToolResultUser(m: Message): boolean {
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
 * round-trip is never split across a turn cut:
 *  - OpenAI: `role:'tool'` responses (not `role:'user'`, so already never open a turn).
 *  - Anthropic: a `role:'user'` message carrying a `tool_result` block answers the
 *    preceding `assistant` `tool_use` message; it must stay with it, so it does NOT
 *    open a new turn.
 *
 * Shared by `ccr` (window-keep condensation) and `headroom` (context-fit trim) —
 * both need identical turn boundaries and tool_use/tool_result atomicity.
 */
export function segment(messages: Message[]): { system: Message[]; turns: Message[][] } {
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

/** Total estimated tokens across a set of messages. */
export function tokensOf(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(messageText(m.content)), 0)
}

/** What one message's text mostly is. Drives which optimizers may touch it. */
export type ContentKind = 'json' | 'code' | 'prose'

/**
 * Classify a message's text.
 *
 * `json` when the whole text parses as JSON: a lexical strip would eat object
 * keys that happen to be function words, turning {"is":true} into {"":true}.
 * `code` when the text is dominated by fenced blocks. Everything else is
 * `prose`, including prose that quotes a JSON snippet inline, which the
 * protected-span regex already handles.
 *
 * ponytail: whole-text parse plus a fence-share ratio. No tokenizer, no
 * language guess. Refine only if a real payload is misclassified.
 */
export function contentKind(text: string): ContentKind {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // not whole-text JSON, fall through
    }
  }
  const fenced = [...trimmed.matchAll(/```[\s\S]*?```/g)].reduce((n, m) => n + m[0]!.length, 0)
  if (trimmed.length > 0 && fenced / trimmed.length > 0.5) return 'code'
  return 'prose'
}
