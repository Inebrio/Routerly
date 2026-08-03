/**
 * Usage records waiting for their trace to finish.
 *
 * A record is built where the call is accounted (end of the upstream call), but
 * the trace keeps growing after that: response guardrails, the PII scan of the
 * answer, what egress wrote, and the recap all land later. Writing the record
 * there would store a trace truncated at `model:success`, which is exactly the
 * detail the usage view exists to show.
 *
 * So a record whose trace is still open is held here and written once the trace
 * is closed — one file write, same as before, no second pass over usage.json.
 */
import type { UsageRecord } from '@routerly/shared'
import { appendUsageRecords } from '../config/loader.js'
import { getTrace } from '../trace/store.js'

/** Backstop for a trace that never closes (a lane that dies before finalize). */
const MAX_WAIT_MS = 30_000

const pending = new Map<string, UsageRecord[]>()
const timers = new Map<string, NodeJS.Timeout>()

/** Holds a record until `flushTrace` is called for its trace. */
export function deferRecord(traceId: string, record: UsageRecord): void {
  const queued = pending.get(traceId)
  if (queued) {
    queued.push(record)
    return
  }
  pending.set(traceId, [record])
  const timer = setTimeout(() => void flushTrace(traceId), MAX_WAIT_MS)
  // The wait must never keep the process alive on its own.
  timer.unref?.()
  timers.set(traceId, timer)
}

/**
 * Writes every record held for this trace, each carrying the trace as it stands
 * now. All of them go in a single write: one trace can account more than one
 * call (the routing judge, a guardrail model) and they finish together.
 */
export async function flushTrace(traceId: string): Promise<void> {
  const records = pending.get(traceId)
  pending.delete(traceId)
  const timer = timers.get(traceId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(traceId)
  }
  if (!records || records.length === 0) return
  const trace = getTrace(traceId)
  if (trace) for (const record of records) record.trace = [...trace]
  await appendUsageRecords(records)
}

/** Test seam: drops everything still waiting. */
export function resetPendingUsage(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  pending.clear()
}
