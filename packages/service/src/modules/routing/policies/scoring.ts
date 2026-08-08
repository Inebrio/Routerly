import type { UsageRecord } from '@routerly/shared';

/**
 * Pure decay/ratio arithmetic shared by usage-record-driven policies
 * (`health`, `performance`, `rate-limit`, `fairness`) and, keyed by
 * `routerId` instead of `modelId`, by the Orchestrator's candidate scoring.
 *
 * No I/O here — every function takes already-filtered records/numbers and
 * returns a number or small plain object. Filtering (time window, outcome
 * exclusion, which records belong to which candidate) stays with the caller.
 */

/**
 * Exponential-decay-weighted error rate with a circuit-breaker cutoff and
 * Bayesian smoothing. `records` must already be window-filtered and scoped
 * to the candidate; `isError` classifies each record as an error/timeout.
 */
export function decayWeightedErrorScore(
  records: UsageRecord[],
  now: number,
  halfLifeMs: number,
  pseudoCounts: number,
  circuitBreaker: number,
  isError: (r: UsageRecord) => boolean = r => r.outcome === 'error' || r.outcome === 'timeout',
): { point: number; weightedErrorRate: number; errorScore: number } {
  if (records.length === 0) {
    return { point: 1.0, weightedErrorRate: 0, errorScore: 1.0 };
  }

  let weightedErrors = 0;
  let weightedTotal = 0;

  for (const r of records) {
    // W(age) = 2^(-age / halfLife) — exponential decay
    const ageMs = now - new Date(r.timestamp).getTime();
    const weight = Math.exp((-Math.LN2 * ageMs) / halfLifeMs);

    weightedErrors += isError(r) ? weight : 0;
    weightedTotal += weight;
  }

  const rawWeightedErrorRate = weightedErrors / weightedTotal;

  // Bayesian smoothing: pseudo-counts act as a success prior
  const smoothedErrorRate = weightedErrors / (weightedTotal + pseudoCounts);

  // Circuit breaker: raw rate above threshold → score = 0
  const errorScore = rawWeightedErrorRate >= circuitBreaker
    ? 0.0
    : 1 - smoothedErrorRate;

  return {
    point: Math.max(0, Math.min(1, errorScore)),
    weightedErrorRate: rawWeightedErrorRate,
    errorScore,
  };
}

/**
 * Exponential-decay-weighted average latency (or simple average when
 * `halfLifeMs` is 0). `records` must already be window/outcome-filtered and
 * scoped to the candidate. Returns `null` when there is no data.
 */
export function decayWeightedLatencyAverage(
  records: UsageRecord[],
  now: number,
  halfLifeMs: number,
): number | null {
  if (records.length === 0) return null;

  const useDecay = halfLifeMs > 0;
  let weightedLatency = 0;
  let weightedTotal = 0;

  for (const r of records) {
    const weight = useDecay
      ? Math.exp((-Math.LN2 * (now - new Date(r.timestamp).getTime())) / halfLifeMs)
      : 1;
    weightedLatency += r.latencyMs * weight;
    weightedTotal += weight;
  }

  return weightedTotal > 0 ? weightedLatency / weightedTotal : null;
}

/**
 * Relative-latency comparison: the fastest candidate with data gets 1.0,
 * others scale by `minLatency / avgLatency`. Candidates with `null` latency
 * (no/insufficient data) get 1.0 (exploration). Fewer than 2 candidates with
 * data makes the comparison meaningless (self-comparison always yields 1.0)
 * — everyone gets 1.0 in that case.
 */
export function relativeLatencyScore(avgLatencies: (number | null)[]): number[] {
  const withData = avgLatencies.filter((v): v is number => v !== null);
  const minLatency = withData.length >= 2 ? Math.min(...withData) : null;

  return avgLatencies.map(avg => {
    const score = avg === null || minLatency === null
      ? 1.0
      : minLatency / avg;
    return Math.max(0, Math.min(1, score));
  });
}

/**
 * Proportional ratio score: minCount / count. `count === 0` yields 1.0.
 */
export function ratioScore(count: number, minCount: number): number {
  if (count === 0) return 1.0;
  return Math.max(0, Math.min(1, minCount / count));
}

/**
 * Share score: 1 - (ownCount / totalCount). `totalCount === 0` yields 1.0.
 */
export function shareScore(ownCount: number, totalCount: number): number {
  if (totalCount === 0) return 1.0;
  return Math.max(0, Math.min(1, 1 - ownCount / totalCount));
}
