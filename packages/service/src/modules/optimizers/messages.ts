import type { ChatCompletionRequest, Message } from '@routerly/shared'

// Reuse the canonical string|content-block flattener from the reverse-proxy
// helpers; optimizer submodules extract message text through this single source.
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
