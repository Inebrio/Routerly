/**
 * In-memory buffer of the traces still in flight, one per request id.
 *
 * The durable copy of a trace is the one the usage record carries; this buffer
 * only has to survive long enough for the finalize phase to snapshot it and for
 * the playground to read it back, so entries are dropped after MAX_AGE_MS.
 *
 * Nothing writes here directly: the trace module subscribes the kernel event bus
 * and records what the phases publish.
 */
import type { TraceEntry } from '@routerly/shared'

/**
 * Which panel of the playground an entry belongs to:
 *   'router-request'  → Router Request  (intake + policy configs)
 *   'router-response' → Router Response (policy results + final score)
 *   'request'         → Request         (payload adapted for each model)
 *   'response'        → Response        (each model's answer or error)
 */
export type TracePanel = 'router-request' | 'router-response' | 'request' | 'response'

/** What a module publishes on the bus. The topic carries phase/module/event; this is the body. */
export interface TraceEvent {
  traceId: string
  entry: TraceEntry
  projectId?: string
  /**
   * Id the caller put on the request so it can follow its own trace live. It never
   * reaches the upstream request or the response: it only keys the side channel.
   */
  correlationId?: string
}

const MAX_AGE_MS = 5 * 60 * 1_000

interface TraceRecord {
  entries: TraceEntry[]
  ts: number
  correlationId?: string
  projectId?: string
}

const store = new Map<string, TraceRecord>()

function cleanup(): void {
  const cutoff = Date.now() - MAX_AGE_MS
  for (const [id, rec] of store) {
    if (rec.ts < cutoff) store.delete(id)
  }
}

/** Start a trace. Nothing is recorded for an id that was never opened. */
export function openTrace(traceId: string, meta?: { correlationId?: string; projectId?: string }): void {
  cleanup()
  store.set(traceId, {
    entries: [],
    ts: Date.now(),
    ...(meta?.correlationId ? { correlationId: meta.correlationId } : {}),
    ...(meta?.projectId ? { projectId: meta.projectId } : {}),
  })
}

export function recordTrace(event: TraceEvent): void {
  const rec = store.get(event.traceId)
  if (!rec) return
  rec.entries.push(event.entry)
}

export function getTrace(traceId: string): TraceEntry[] | null {
  return store.get(traceId)?.entries ?? null
}

/** When the trace was opened (ingress). The only wall-clock the recap can trust. */
export function getTraceStartedAt(traceId: string): number | undefined {
  return store.get(traceId)?.ts
}

/** The correlation id a caller sent for this trace, if any. */
export function getTraceCorrelationId(traceId: string): string | undefined {
  return store.get(traceId)?.correlationId
}

/** Test seam: drops every buffered trace. */
export function resetTraceStore(): void {
  store.clear()
}
