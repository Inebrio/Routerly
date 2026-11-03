/**
 * The trace event contract.
 *
 * Every routing-related module reports what it did by publishing here; the trace
 * module is the only subscriber that has to exist. The topic is hierarchical so a
 * subscriber can narrow without knowing the producers:
 *
 *   trace/**                    everything
 *   trace/routing.prepare/**    one phase
 *   trace/+/guardrail/**        one module, whatever phase it ran in ('+' is a single '*')
 *   trace/+/+/error             one kind of event
 */
import type { TraceEntry } from '@routerly/shared'
import type { EventBus } from '../../core/index.js'
import type { TraceEvent } from './store.js'

/** Everything publish needs from the request. Kept structural so tests can pass a literal. */
export interface TraceOrigin {
  traceId: string
  routerId?: string
  phase?: string
  correlationId?: string
  /** Router opt-in. False (the default) drops `entry.content` here, before anyone sees it. */
  captureContent?: boolean
}

/**
 * Published once, at the end of a request, with the whole trace. Outside the
 * `trace/**` subtree on purpose: that subtree is single entries going into the
 * buffer, this is the finished trace going out to whoever exports it.
 */
export const TRACE_COMPLETED_TOPIC = 'traces/completed'

export interface TraceCompletedEvent {
  traceId: string
  entries: TraceEntry[]
  routerId?: string
  correlationId?: string
}

/** Topics are '/'-separated: a segment can never introduce one of its own. */
const seg = (s: string): string => (s.replaceAll('/', '_') || 'unknown')

/**
 * `message` is the existing `module:event` convention ('pii:scrubbed',
 * 'policy:result:cheapest'), so the module and the event name are read from it
 * rather than repeated at every call site.
 */
export function traceTopic(phase: string | undefined, message: string): string {
  const [module = '', ...rest] = message.split(':')
  return `trace/${seg(phase ?? 'unknown')}/${seg(module)}/${seg(rest.join(':'))}`
}

/**
 * Stamp the entry with where it came from and publish it.
 *
 * The content gate is here and nowhere else: producers always fill `entry.content`
 * with the prompts and answers they saw, and a router that did not opt in never
 * gets them past this function — not to the buffer, not to usage.json, not to the
 * side channel.
 */
export function publishTrace(events: EventBus, origin: TraceOrigin, entry: TraceEntry): void {
  const [module = ''] = entry.message.split(':')
  const { content, ...metadata } = entry
  const stamped: TraceEntry = {
    ...metadata,
    ...(origin.captureContent && content ? { content } : {}),
    at: Date.now(),
    module: seg(module),
    ...(origin.phase ? { phase: origin.phase } : {}),
  }
  const event: TraceEvent = {
    traceId: origin.traceId,
    entry: stamped,
    ...(origin.routerId ? { routerId: origin.routerId } : {}),
    ...(origin.correlationId ? { correlationId: origin.correlationId } : {}),
  }
  events.publish(traceTopic(origin.phase, entry.message), event)
}
