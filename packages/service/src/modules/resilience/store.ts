import type { ResilienceEntry, ResilienceFault, ResilienceKey, ResilienceSnapshot, ResilienceStore } from '@routerly/shared';

// ponytail: 5 hard faults / 60s rolling window is a guess, tune from real provider incident data.
const PROVIDER_FAILURE_THRESHOLD = 5;
const PROVIDER_WINDOW_MS = 60_000;

// ponytail: 60s open duration before the first half-open probe is a guess, tune from real provider recovery times.
const PROVIDER_OPEN_MS = 60_000;

// ponytail: 30s default connection cooldown (used only when the provider gave no retry-after) is a guess, tune from observed rate-limit windows.
const DEFAULT_COOLDOWN_MS = 30_000;

// ponytail: 5 minute model-instance lockout (longer than the cooldown default, per brief) is a guess, tune from real 404/content-safety recurrence rates.
const MODEL_LOCKOUT_MS = 300_000;

/** Internal bookkeeping the public `ResilienceEntry` doesn't expose. */
interface InternalEntry extends ResilienceEntry {
  /** Compare-and-set flag for `tryProbe` — exactly one half-open probe in flight. */
  probeInFlight: boolean;
  /** Epoch ms of hard faults still inside the rolling window (provider circuit breaker only). */
  faultTimestamps: number[];
}

function mapKey(key: ResilienceKey): string {
  return `${key.level}:${key.id}`;
}

function toPublicEntry(entry: InternalEntry): ResilienceEntry {
  const out: ResilienceEntry = {
    key: { ...entry.key },
    state: entry.state,
    failureCount: entry.failureCount,
  };
  if (entry.lastFault !== undefined) out.lastFault = entry.lastFault;
  if (entry.openedAt !== undefined) out.openedAt = entry.openedAt;
  if (entry.cooldownUntil !== undefined) out.cooldownUntil = entry.cooldownUntil;
  if (entry.lockoutUntil !== undefined) out.lockoutUntil = entry.lockoutUntil;
  return out;
}

/**
 * In-memory implementation of the 3-level resilience store (provider circuit-breaker,
 * connection cooldown, model-instance lockout). One `Map<string, InternalEntry>` keyed by
 * `${level}:${id}`, no cross-key coordination.
 *
 * ponytail: `tryProbe`'s compare-and-set is a plain boolean read-then-write, not a real lock —
 * Node's single-threaded event loop makes it atomic within one microtask for this in-process
 * store. A per-key lock only matters once a shared/cluster store (e.g. Redis-backed) replaces
 * this behind the same `ResilienceStore` interface.
 */
export class InMemoryResilienceStore implements ResilienceStore {
  private readonly entries = new Map<string, InternalEntry>();

  private getOrCreate(key: ResilienceKey): InternalEntry {
    const mk = mapKey(key);
    let entry = this.entries.get(mk);
    if (!entry) {
      entry = { key: { ...key }, state: 'closed', failureCount: 0, probeInFlight: false, faultTimestamps: [] };
      this.entries.set(mk, entry);
    }
    return entry;
  }

  record(key: ResilienceKey, fault: ResilienceFault): void {
    const entry = this.getOrCreate(key);
    entry.lastFault = fault.category;

    switch (fault.category) {
      // A client-request problem, not upstream unavailability: lastFault only, never trip/
      // extend/close any breaker, cooldown, or lockout.
      case 'invalid-request':
        return;

      case 'auth':
      case 'server':
      case 'timeout':
        this.recordHardFault(entry);
        return;

      case 'rate-limit':
      case 'quota':
        this.recordCooldown(entry, fault);
        return;

      case 'model-not-found':
      case 'content-safety':
        this.recordLockout(entry);
        return;
    }
  }

  recordSuccess(key: ResilienceKey): void {
    const entry = this.entries.get(mapKey(key));
    if (!entry || entry.state !== 'half-open') return;
    entry.state = 'closed';
    entry.failureCount = 0;
    entry.faultTimestamps = [];
    delete entry.openedAt;
    entry.probeInFlight = false;
  }

  private recordHardFault(entry: InternalEntry): void {
    const now = Date.now();

    if (entry.state === 'half-open') {
      // A hard fault during the single half-open probe is direct evidence the provider is still
      // down: reopen immediately rather than waiting for the full threshold again.
      entry.faultTimestamps = [now];
      entry.failureCount = 1;
      entry.state = 'open';
      entry.openedAt = now;
      entry.probeInFlight = false;
      return;
    }

    entry.faultTimestamps.push(now);
    entry.faultTimestamps = entry.faultTimestamps.filter((t) => now - t <= PROVIDER_WINDOW_MS);
    entry.failureCount = entry.faultTimestamps.length;

    if (entry.state === 'closed' && entry.failureCount >= PROVIDER_FAILURE_THRESHOLD) {
      entry.state = 'open';
      entry.openedAt = now;
    }
  }

  private recordCooldown(entry: InternalEntry, fault: ResilienceFault): void {
    const now = Date.now();
    const computedUntil = now + (fault.retryAfterMs ?? DEFAULT_COOLDOWN_MS);
    entry.cooldownUntil = fault.resetAt !== undefined && fault.resetAt > computedUntil ? fault.resetAt : computedUntil;
  }

  private recordLockout(entry: InternalEntry): void {
    entry.lockoutUntil = Date.now() + MODEL_LOCKOUT_MS;
  }

  isAvailable(key: ResilienceKey): boolean {
    const entry = this.entries.get(mapKey(key));
    if (!entry) return true;

    const now = Date.now();
    if (entry.state === 'open') return false;
    // Only the request granted by tryProbe() may pass during half-open; everything else waits.
    if (entry.state === 'half-open') return false;
    if (entry.cooldownUntil !== undefined && now < entry.cooldownUntil) return false;
    if (entry.lockoutUntil !== undefined && now < entry.lockoutUntil) return false;
    return true;
  }

  tryProbe(key: ResilienceKey): boolean {
    const entry = this.entries.get(mapKey(key));
    if (!entry) return true;

    const now = Date.now();
    if (entry.state === 'open') {
      // openedAt is always set in the same assignment that sets state='open' (recordHardFault).
      if (now < entry.openedAt! + PROVIDER_OPEN_MS) return false;
      entry.state = 'half-open';
      entry.probeInFlight = true;
      return true;
    }

    // `probeInFlight` is set true at the moment state becomes 'half-open' (above) and only
    // cleared by recordSuccess() closing the breaker or a hard fault reopening it, both of
    // which also move state away from 'half-open' — so reaching this branch always means a
    // probe is already out.
    if (entry.state === 'half-open') return false; // atomic compare-and-set: single probe already out

    return true; // closed: nothing to probe, already available
  }

  snapshot(): ResilienceSnapshot {
    return {
      entries: Array.from(this.entries.values()).map(toPublicEntry),
      generatedAt: Date.now(),
    };
  }

  reset(key?: ResilienceKey): void {
    if (!key) {
      this.entries.clear();
      return;
    }
    this.entries.delete(mapKey(key));
  }
}
