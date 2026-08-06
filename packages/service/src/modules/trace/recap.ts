/**
 * The synthetic level of the trace: one entry that answers "what happened to
 * this request" without reading the other N.
 *
 * Purely derived — every number comes from an entry already in the buffer, so
 * the recap can never disagree with the detail below it. It is built here, once,
 * rather than in each consumer: the dashboard summary, the console print and any
 * exporter read the same aggregate.
 */
import type { TraceEntry } from '@routerly/shared'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Sums the per-entity counters `pii:evaluated` carries. */
function redactedCount(entry: TraceEntry | undefined): number {
  const counts = entry?.details.counts
  if (!counts || typeof counts !== 'object') return 0
  return Object.values(counts as Record<string, unknown>).reduce<number>((t, v) => t + num(v), 0)
}

export function buildRecap(entries: TraceEntry[], durationMs: number): TraceEntry {
  const of = (message: string, panel?: string): TraceEntry[] =>
    entries.filter((e) => e.message === message && (panel === undefined || e.panel === panel))
  const sum = (list: TraceEntry[], key: string): number =>
    list.reduce((total, e) => total + num(e.details[key]), 0)

  // Panels split the client's completion from Routerly's own LLM calls (routing,
  // guardrail judge): mixing them would report the router's spend as the user's.
  const attempts = of('model:request', 'request')
  const served = of('model:success', 'response')
  const failed = of('model:error', 'response')
  const overhead = of('model:success', 'router-response')
  const last = served[served.length - 1]

  const rules = [...of('guardrail:evaluated', 'request'), ...of('guardrail:evaluated', 'response')]
    .flatMap((e) => (Array.isArray(e.details.rules) ? (e.details.rules as Array<Record<string, unknown>>) : []))
  const triggered = [...of('guardrail:triggered', 'request'), ...of('guardrail:response-triggered', 'response')]
  const blockedBy = triggered.find((e) => e.details.block === true)

  const steps = of('optimizer:step')
  const applied = steps.filter((e) => e.details.outcome === 'applied')

  const piiRequest = of('pii:evaluated', 'request')[0]
  const piiResponse = of('pii:evaluated', 'response')[0]

  const outcome = blockedBy ? 'blocked' : served.length > 0 ? 'ok' : failed.length > 0 ? 'error' : 'incomplete'

  return {
    panel: 'router-response',
    message: 'trace:recap',
    details: {
      outcome,
      durationMs,
      ...(text(last?.details.modelId) ? { model: text(last?.details.modelId) } : {}),
      ...(text(attempts[attempts.length - 1]?.details.provider)
        ? { provider: text(attempts[attempts.length - 1]?.details.provider) }
        : {}),
      attempts: attempts.length,
      tokens: {
        input: sum(served, 'inputTokens'),
        cachedInput: sum(served, 'cachedInputTokens'),
        output: sum(served, 'outputTokens'),
      },
      costUsd: sum(served, 'totalCostUsd'),
      latencyMs: sum(served, 'latencyMs'),
      ...(last?.details.ttftMs != null ? { ttftMs: num(last.details.ttftMs) } : {}),
      ...(last?.details.tokensPerSec != null ? { tokensPerSec: num(last.details.tokensPerSec) } : {}),
      // Routerly's own calls, kept apart so "what did this request cost me" stays
      // the client-facing number and the router's overhead is still visible.
      ...(overhead.length > 0
        ? { overhead: { calls: overhead.length, costUsd: sum(overhead, 'totalCostUsd') } }
        : {}),
      ...(rules.length > 0 || triggered.length > 0 || of('guardrail:injected').length > 0
        ? {
            guardrails: {
              rules: rules.length,
              triggered: rules.filter((r) => r.outcome === 'triggered').length,
              skipped: rules.filter((r) => r.outcome === 'skipped').length,
              injected: of('guardrail:injected').length,
              ...(blockedBy ? { blockedBy: text(blockedBy.details.rule) ?? true } : {}),
            },
          }
        : {}),
      ...(piiRequest || piiResponse
        ? { pii: { request: redactedCount(piiRequest), response: redactedCount(piiResponse) } }
        : {}),
      ...(steps.length > 0
        ? {
            optimizers: {
              steps: steps.length,
              applied: applied.length,
              rolledBack: steps.filter((e) => e.details.outcome === 'rolled-back').length,
              savedTokens: sum(applied, 'saved'),
            },
          }
        : {}),
      ...(failed.length > 0
        ? {
            errors: failed.map((e) => ({
              model: text(e.details.modelId) ?? 'unknown',
              error: text(e.details.error) ?? 'unknown',
            })),
          }
        : {}),
    },
  }
}
