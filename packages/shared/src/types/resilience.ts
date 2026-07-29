// ─── Resilience (circuit breaker) types ──────────────────────────────────────

/** Scope a circuit breaker key applies to. */
export type ResilienceLevel = 'provider' | 'connection' | 'model';

/** Circuit breaker state machine. */
export type ResilienceState = 'closed' | 'open' | 'half-open';

/** Classification of an upstream provider failure. */
export interface ResilienceFault {
  category:
    | 'auth'
    | 'rate-limit'
    | 'quota'
    | 'timeout'
    | 'server'
    | 'invalid-request'
    | 'model-not-found'
    | 'content-safety';
  /** Milliseconds to wait before retrying, derived from provider retry-after headers. */
  retryAfterMs?: number;
  /** Epoch ms when a quota/rate-limit window resets, if the provider communicated one. */
  resetAt?: number;
}

/** Identifies the breaker for a given provider, connection, or model. */
export interface ResilienceKey {
  level: ResilienceLevel;
  id: string;
}
