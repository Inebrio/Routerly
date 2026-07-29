import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryResilienceStore } from './store.js';

describe('InMemoryResilienceStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the provider circuit after 5 hard faults, half-open probes atomically, connection cooldown honors retryAfterMs, and reset() clears everything', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 5; i++) s.record(k, { category: 'server' });

    expect(s.isAvailable(k)).toBe(false); // opened
    expect(s.snapshot().entries[0]?.state).toBe('open');

    vi.advanceTimersByTime(60_000);
    expect(s.tryProbe(k)).toBe(true); // first probe wins
    expect(s.tryProbe(k)).toBe(false); // second blocked (atomic single probe)

    s.record({ level: 'connection', id: 'c1' }, { category: 'rate-limit', retryAfterMs: 30_000 });
    expect(s.isAvailable({ level: 'connection', id: 'c1' })).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(s.isAvailable({ level: 'connection', id: 'c1' })).toBe(true); // cooldown elapsed

    s.reset();
    expect(s.snapshot().entries).toHaveLength(0);
  });

  it('reports available for a key that has never faulted', () => {
    const s = new InMemoryResilienceStore();
    expect(s.isAvailable({ level: 'provider', id: 'unknown' })).toBe(true);
  });

  it('tryProbe on a never-faulted key returns true (nothing to probe)', () => {
    const s = new InMemoryResilienceStore();
    expect(s.tryProbe({ level: 'provider', id: 'unknown' })).toBe(true);
  });

  it('keeps the circuit open until openMs has elapsed', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 5; i++) s.record(k, { category: 'server' });

    vi.advanceTimersByTime(59_999);
    expect(s.tryProbe(k)).toBe(false);
    expect(s.snapshot().entries[0]?.state).toBe('open');
  });

  it('mixes auth/server/timeout toward the same provider breaker', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'anthropic' } as const;
    s.record(k, { category: 'auth' });
    s.record(k, { category: 'timeout' });
    s.record(k, { category: 'server' });
    s.record(k, { category: 'auth' });
    expect(s.isAvailable(k)).toBe(true); // only 4 so far
    s.record(k, { category: 'server' });
    expect(s.isAvailable(k)).toBe(false); // 5th trips it
    expect(s.snapshot().entries[0]?.failureCount).toBe(5);
  });

  it('drops hard faults outside the rolling window so the breaker never trips', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    s.record(k, { category: 'server' });
    vi.advanceTimersByTime(60_001); // outside the 60s window
    s.record(k, { category: 'server' });
    s.record(k, { category: 'server' });
    s.record(k, { category: 'server' });
    s.record(k, { category: 'server' });
    // only 4 faults inside the current window (the first aged out)
    expect(s.isAvailable(k)).toBe(true);
    expect(s.snapshot().entries[0]?.failureCount).toBe(4);
  });

  it('applies the default cooldown when the provider gives no retryAfterMs', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'connection', id: 'c2' } as const;
    s.record(k, { category: 'quota' });
    expect(s.isAvailable(k)).toBe(false);
    vi.advanceTimersByTime(29_999);
    expect(s.isAvailable(k)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(s.isAvailable(k)).toBe(true);
  });

  it('prefers resetAt over the computed cooldown when resetAt is later', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'connection', id: 'c3' } as const;
    const resetAt = Date.now() + 120_000; // far later than now + retryAfterMs
    s.record(k, { category: 'quota', retryAfterMs: 5_000, resetAt });
    expect(s.snapshot().entries[0]?.cooldownUntil).toBe(resetAt);
    vi.advanceTimersByTime(5_001); // computed cooldown would have expired by now
    expect(s.isAvailable(k)).toBe(false); // still cooled down per resetAt
    vi.advanceTimersByTime(120_000 - 5_001);
    expect(s.isAvailable(k)).toBe(true);
  });

  it('ignores a later resetAt when it is earlier than the computed cooldown', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'connection', id: 'c4' } as const;
    const now = Date.now();
    s.record(k, { category: 'rate-limit', retryAfterMs: 30_000, resetAt: now + 1_000 });
    expect(s.snapshot().entries[0]?.cooldownUntil).toBe(now + 30_000);
  });

  it('locks out a model instance on model-not-found/content-safety for longer than the cooldown default', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'model', id: 'gpt-4o' } as const;
    s.record(k, { category: 'model-not-found' });
    expect(s.isAvailable(k)).toBe(false);
    expect(s.snapshot().entries[0]?.state).toBe('closed'); // lockout isn't the circuit-breaker state
    vi.advanceTimersByTime(30_000); // past the connection cooldown default...
    expect(s.isAvailable(k)).toBe(false); // ...but still locked out (longer duration)
    vi.advanceTimersByTime(300_000 - 30_000);
    expect(s.isAvailable(k)).toBe(true);
  });

  it('locks out on content-safety faults too', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'model', id: 'claude-3' } as const;
    s.record(k, { category: 'content-safety' });
    expect(s.isAvailable(k)).toBe(false);
  });

  it('records invalid-request as lastFault only, never trips/changes state or failureCount', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 10; i++) s.record(k, { category: 'invalid-request' });
    expect(s.isAvailable(k)).toBe(true);
    const entry = s.snapshot().entries[0];
    expect(entry?.state).toBe('closed');
    expect(entry?.failureCount).toBe(0);
    expect(entry?.lastFault).toBe('invalid-request');
  });

  it('invalid-request does not close an in-flight half-open probe either', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 5; i++) s.record(k, { category: 'server' });
    vi.advanceTimersByTime(60_000);
    expect(s.tryProbe(k)).toBe(true);
    s.record(k, { category: 'invalid-request' });
    expect(s.snapshot().entries[0]?.state).toBe('half-open');
  });

  it('closes half-open -> closed when a non-hard fault is recorded post-probe (only signal record() can carry)', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 5; i++) s.record(k, { category: 'server' });
    vi.advanceTimersByTime(60_000);
    expect(s.tryProbe(k)).toBe(true); // half-open, probe granted
    expect(s.isAvailable(k)).toBe(false); // only the granted probe may pass, not general traffic

    s.record(k, { category: 'rate-limit' }); // not evidence the provider itself is down

    const entry = s.snapshot().entries[0];
    expect(entry?.state).toBe('closed'); // circuit breaker itself is fully reset
    expect(entry?.failureCount).toBe(0);
    expect(entry?.openedAt).toBeUndefined();
    // the rate-limit fault still applies its own cooldown independent of the breaker reset
    expect(s.isAvailable(k)).toBe(false);
    vi.advanceTimersByTime(30_000); // DEFAULT_COOLDOWN_MS
    expect(s.isAvailable(k)).toBe(true);

    // a fresh probe is grantable again since the breaker fully reset
    // (tryProbe on a closed key is a no-op true, not a second probe token)
    expect(s.tryProbe(k)).toBe(true);
  });

  it('reopens immediately when a hard fault arrives during the half-open probe', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 5; i++) s.record(k, { category: 'server' });
    vi.advanceTimersByTime(60_000);
    expect(s.tryProbe(k)).toBe(true); // half-open, probe granted

    s.record(k, { category: 'server' }); // the probe itself failed

    expect(s.snapshot().entries[0]?.state).toBe('open');
    expect(s.isAvailable(k)).toBe(false);
    expect(s.tryProbe(k)).toBe(false); // freshly reopened, still inside the new openMs window
  });

  it('reset(key) removes only that key, leaving other entries untouched', () => {
    const s = new InMemoryResilienceStore();
    const provider = { level: 'provider', id: 'openai' } as const;
    const connection = { level: 'connection', id: 'c1' } as const;
    for (let i = 0; i < 5; i++) s.record(provider, { category: 'server' });
    s.record(connection, { category: 'rate-limit', retryAfterMs: 10_000 });

    s.reset(provider);

    expect(s.snapshot().entries).toHaveLength(1);
    expect(s.snapshot().entries[0]?.key).toEqual(connection);
    expect(s.isAvailable(provider)).toBe(true); // gone -> defaults to available
    expect(s.isAvailable(connection)).toBe(false); // untouched
  });

  it('snapshot returns a deep copy that callers cannot use to mutate internal state', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    for (let i = 0; i < 5; i++) s.record(k, { category: 'server' });

    const snap = s.snapshot();
    const entry = snap.entries[0];
    if (entry) {
      entry.state = 'closed';
      entry.failureCount = 0;
      entry.key.id = 'tampered';
    }

    expect(s.isAvailable(k)).toBe(false); // internal state unaffected by the mutation above
    expect(s.snapshot().entries[0]?.state).toBe('open');
    expect(s.snapshot().entries[0]?.key.id).toBe('openai');
  });

  it('snapshot omits internal-only fields (probeInFlight, faultTimestamps) from public entries', () => {
    const s = new InMemoryResilienceStore();
    const k = { level: 'provider', id: 'openai' } as const;
    s.record(k, { category: 'server' });
    const entry = s.snapshot().entries[0] as unknown as Record<string, unknown>;
    expect(entry).not.toHaveProperty('probeInFlight');
    expect(entry).not.toHaveProperty('faultTimestamps');
  });
});
