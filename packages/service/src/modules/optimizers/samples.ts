import type { Message } from '@routerly/shared'
import { tokensOf } from './messages.js'

/**
 * Recent real prompts, kept in memory so an operator can tune a pipeline against
 * their own traffic instead of a made-up sample (T63).
 *
 * Deliberately NOT persisted. The usage log stores token counts and never the
 * message bodies, and this feature is not a reason to start writing prompts to
 * disk: the buffer lives for the life of the process and is gone on restart.
 * Capture happens after the PII scrub, so whatever the scrubber redacted is
 * already redacted here.
 *
 * ponytail: a fixed ring per project, no eviction by age. A handful of prompts
 * per project is all the preview needs; add a TTL only if a long-lived process
 * with many projects turns out to hold on to too much.
 */

/** One captured prompt. */
export interface TrafficSample {
  /** ISO timestamp of the request this came from. */
  capturedAt: string
  /** The prompt as the pipeline saw it, trimmed to the caps below. */
  messages: Message[]
  /** Estimated prompt tokens, before trimming, so the operator sees the real size. */
  estimatedTokens: number
  /** Set when the prompt was longer than the caps and what is stored is an excerpt. */
  truncated?: boolean
}

/** Prompts kept per project. */
const MAX_PER_PROJECT = 5
/** Newest messages kept from one prompt. */
const MAX_MESSAGES = 20
/** Characters kept from one message's text. */
const MAX_CHARS = 1000

const buffers = new Map<string, TrafficSample[]>()

/** Clip one message's text to MAX_CHARS, preserving its content shape. */
function clipMessage(m: Message): { message: Message; clipped: boolean } {
  if (typeof m.content === 'string') {
    if (m.content.length <= MAX_CHARS) return { message: m, clipped: false }
    return { message: { ...m, content: `${m.content.slice(0, MAX_CHARS)}...` }, clipped: true }
  }
  if (!Array.isArray(m.content)) return { message: m, clipped: false }
  let clipped = false
  const parts = m.content.map(part => {
    const text = (part as { text?: unknown }).text
    if (typeof text !== 'string' || text.length <= MAX_CHARS) return part
    clipped = true
    return { ...part, text: `${text.slice(0, MAX_CHARS)}...` }
  })
  return { message: { ...m, content: parts } as Message, clipped }
}

/**
 * Record a prompt for this project, dropping the oldest sample once the ring is
 * full. Empty prompts are ignored: they teach a preview nothing.
 */
export function captureSample(projectId: string, messages: Message[], capturedAt = new Date().toISOString()): void {
  if (!projectId || messages.length === 0) return

  const estimatedTokens = tokensOf(messages)
  const kept = messages.slice(-MAX_MESSAGES)
  let truncated = kept.length < messages.length
  const trimmed = kept.map(m => {
    const { message, clipped } = clipMessage(m)
    if (clipped) truncated = true
    return message
  })

  const buffer = buffers.get(projectId) ?? []
  buffer.push({
    capturedAt,
    messages: trimmed,
    estimatedTokens,
    ...(truncated ? { truncated: true } : {}),
  })
  if (buffer.length > MAX_PER_PROJECT) buffer.splice(0, buffer.length - MAX_PER_PROJECT)
  buffers.set(projectId, buffer)
}

/** Samples captured for a project, newest first. Empty when nothing ran since boot. */
export function listSamples(projectId: string): TrafficSample[] {
  return [...(buffers.get(projectId) ?? [])].reverse()
}

/** Drop every buffer. Used by tests and by nothing else. */
export function clearSamples(): void {
  buffers.clear()
}
