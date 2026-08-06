import type { ResilienceEntry, ResilienceKey, ResilienceLevel, ResilienceStore } from '@routerly/shared';
import type { CandidateModel } from '../routing/policies/types.js';
import { resilienceKeys } from './keys.js';

export interface ResilienceExclusion {
  modelId: string;
  level: ResilienceLevel;
  until?: number;
}

export interface FilterAvailableResult {
  available: CandidateModel[];
  excluded: ResilienceExclusion[];
}

function entryFor(store: ResilienceStore, key: ResilienceKey): ResilienceEntry | undefined {
  return store.snapshot().entries.find(e => e.key.level === key.level && e.key.id === key.id);
}

/**
 * Picks the single timestamp that best represents "when does this key recover", in the
 * priority order the brief specifies: cooldownUntil, then lockoutUntil, then openedAt.
 */
function untilFor(entry: ResilienceEntry | undefined): number | undefined {
  if (!entry) return undefined;
  return entry.cooldownUntil ?? entry.lockoutUntil ?? entry.openedAt;
}

/**
 * `tryProbe` only means something for the circuit-breaker state machine (open → half-open):
 * on a 'closed' entry it unconditionally returns true ("nothing to probe"), even when the key
 * is unavailable because of a cooldown or lockout timestamp. Cooldowns/lockouts have no probe —
 * they simply expire once `isAvailable` sees the clock pass `until`. So only spend the probe
 * when the entry is actually in the breaker's open/half-open state.
 */
function isProbeable(entry: ResilienceEntry | undefined): boolean {
  return entry?.state === 'open' || entry?.state === 'half-open';
}

/**
 * Hard pre-filter: excludes candidates whose provider, connection, or model resilience key is
 * currently unavailable (open circuit, cooldown, or lockout), granting at most one half-open
 * probe per key. If every candidate ends up excluded, falls back to the single candidate
 * closest to recovery so the caller never receives an empty candidate list.
 */
export function filterAvailable(candidates: CandidateModel[], store: ResilienceStore): FilterAvailableResult {
  const available: CandidateModel[] = [];
  const excluded: ResilienceExclusion[] = [];
  const excludedCandidates = new Map<string, CandidateModel>();

  for (const candidate of candidates) {
    const keys = resilienceKeys(candidate.model);
    const entries = Object.entries(keys) as [ResilienceLevel, ResilienceKey][];

    // Pass 1 — read-only: collect every key currently blocking this candidate. `isAvailable` has
    // no side effects, so this cannot spend a probe.
    const blockers = entries.filter(([, key]) => !store.isAvailable(key));

    if (blockers.length === 0) {
      available.push(candidate);
      continue;
    }

    // Pass 2 — mutate LAST, and only when it decides the outcome. A candidate can recover via a
    // half-open probe ONLY when a SINGLE breaker key blocks it and that key is probeable. If any
    // other key also blocks (e.g. a connection cooldown alongside an open provider), the probe
    // would be spent on a candidate that stays excluded — wedging the breaker half-open forever
    // (no dispatch → no recordSuccess → never closes). So `tryProbe` runs only for the lone
    // blocker. The first blocker is reported as "the" reason for the trace; a candidate blocked by
    // more than one key at once still reports just one, enough to explain the exclusion.
    const [level, key] = blockers[0]!;
    if (blockers.length === 1 && isProbeable(entryFor(store, key)) && store.tryProbe(key)) {
      available.push(candidate);
      continue;
    }

    const until = untilFor(entryFor(store, key));
    excluded.push({ modelId: candidate.model.id, level, ...(until !== undefined ? { until } : {}) });
    excludedCandidates.set(candidate.model.id, candidate);
  }

  if (available.length === 0 && excluded.length > 0) {
    const fallback = [...excluded].sort((a, b) => {
      const ua = a.until ?? Infinity;
      const ub = b.until ?? Infinity;
      if (ua !== ub) return ua - ub;
      return a.modelId.localeCompare(b.modelId);
    })[0]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    available.push(excludedCandidates.get(fallback.modelId)!);
  }

  return { available, excluded };
}
