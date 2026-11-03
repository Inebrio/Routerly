/**
 * Last deterministic upstream 4xx (invalid key, forbidden, bad request) per router. When the
 * resilience/health policy then excludes every model, the client still gets that provider error
 * (status + body) instead of an opaque "no model available", until the entry expires or a call succeeds.
 */
const TTL_MS = 5 * 60_000
const last = new Map<string, { status: number; body: unknown; at: number }>()

export function rememberUpstreamError(routerId: string, status: number, body: unknown): void {
  last.set(routerId, { status, body, at: Date.now() })
}

export function recallUpstreamError(routerId: string): { status: number; body: unknown } | undefined {
  const e = last.get(routerId)
  if (!e) return undefined
  if (Date.now() - e.at > TTL_MS) { last.delete(routerId); return undefined }
  return e
}

export function forgetUpstreamError(routerId: string): void {
  last.delete(routerId)
}
