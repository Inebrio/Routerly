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

/** Persisted state for a single resilience key. */
export interface ResilienceEntry {
  key: ResilienceKey;
  state: ResilienceState;
  lastFault?: ResilienceFault['category'];
  failureCount: number;
  openedAt?: number; // epoch ms when it left 'closed'
  cooldownUntil?: number; // epoch ms; connection cooldown / rate-limit
  lockoutUntil?: number; // epoch ms; model-instance lockout (longer)
}

/** Point-in-time read of every tracked resilience entry. */
export interface ResilienceSnapshot {
  entries: ResilienceEntry[];
  generatedAt: number;
}

/** Tracks circuit-breaker / cooldown / lockout state across provider, connection, and model levels. */
export interface ResilienceStore {
  record(key: ResilienceKey, fault: ResilienceFault): void;
  recordSuccess(key: ResilienceKey): void; // closes a half-open probe; no-op otherwise
  snapshot(): ResilienceSnapshot;
  isAvailable(key: ResilienceKey): boolean;
  tryProbe(key: ResilienceKey): boolean; // atomic compare-and-set: exactly one half-open probe
  reset(key?: ResilienceKey): void; // key omitted -> reset all
}
