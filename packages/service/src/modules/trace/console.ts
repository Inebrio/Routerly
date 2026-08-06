/**
 * The trace, on the console.
 *
 * Same entries the dashboard shows, one line each, written straight to the
 * process streams: a failure goes to stderr, everything else to stdout, so
 * `routerly ... 2>errors.log` and the usual shell plumbing work on a trace the
 * way they work on any other program output. Docker and systemd capture both.
 *
 * Prompts and answers (`entry.content`) are never printed: they are a per-project
 * opt-in for the trace UI, and logs are a different destination with a different
 * lifetime. The line says whether content was captured, not what it said.
 */
import type { TraceEntry } from '@routerly/shared'
import type { TraceEvent } from './store.js'

/** Levels at which the operator asked the service for less output, not more. */
const QUIET = new Set(['warn', 'error'])

/** A failure is anything that reports an error, a block, or a failed outcome. */
export function isFailure(entry: TraceEntry): boolean {
  if (entry.message.endsWith(':error')) return true
  if (entry.details['error'] !== undefined) return true
  const outcome = entry.details['outcome']
  return outcome === 'error' || outcome === 'blocked'
}

export function formatTraceLine(event: TraceEvent): string {
  const { entry } = event
  const where = `${entry.phase ?? 'unknown'}/${entry.module ?? 'unknown'}`
  let details: string
  try {
    details = JSON.stringify(entry.details) ?? '{}'
  } catch {
    details = '{"trace":"details not serializable"}' // a cyclic detail must not take the request down
  }
  return `trace ${event.traceId} ${where} ${entry.message} ${details}${entry.content ? ' +content' : ''}`
}

/** Writes one entry. `level` is the service log level: warn/error mean errors only. */
export function printTrace(event: TraceEvent, level?: string): void {
  const failure = isFailure(event.entry)
  if (!failure && QUIET.has(level ?? 'info')) return
  const line = `${formatTraceLine(event)}\n`
  if (failure) process.stderr.write(line)
  else process.stdout.write(line)
}
