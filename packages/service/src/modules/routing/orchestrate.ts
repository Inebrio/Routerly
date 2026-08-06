import type { OrchestratorCandidateRef, RouterConfig, UsageRecord } from '@routerly/shared';
import { readUsageRecords } from '../usage/usageStore.js';

// Windows mirror the plain-Router policies this is adapted from (health.ts,
// rate-limit.ts, fairness.ts) — same defaults, keyed by routerId instead of modelId.
const HEALTH_WINDOW_MS = 20 * 60 * 1000;
const HEALTH_HALF_LIFE_MS = 5 * 60 * 1000;
const HEALTH_PSEUDO_COUNTS = 2;
const HEALTH_CIRCUIT_BREAKER = 0.9;
const RATE_LIMIT_WINDOW_MS = 1 * 60 * 1000;
const FAIRNESS_WINDOW_MS = 60 * 60 * 1000;

/** Error-rate score, 0..1, higher is healthier. No recent records -> 1.0 (no signal yet). */
function healthScore(ownRecords: UsageRecord[], now: number): number {
  const recent = ownRecords.filter(r => now - new Date(r.timestamp).getTime() <= HEALTH_WINDOW_MS && r.outcome !== 'blocked');
  if (recent.length === 0) return 1.0;

  let weightedErrors = 0;
  let weightedTotal = 0;
  for (const r of recent) {
    const ageMs = now - new Date(r.timestamp).getTime();
    const weight = Math.exp((-Math.LN2 * ageMs) / HEALTH_HALF_LIFE_MS);
    const isError = r.outcome === 'error' || r.outcome === 'timeout';
    weightedErrors += isError ? weight : 0;
    weightedTotal += weight;
  }

  const rawWeightedErrorRate = weightedErrors / weightedTotal;
  const smoothedErrorRate = weightedErrors / (weightedTotal + HEALTH_PSEUDO_COUNTS);
  const score = rawWeightedErrorRate >= HEALTH_CIRCUIT_BREAKER ? 0.0 : 1 - smoothedErrorRate;
  return Math.max(0, Math.min(1, score));
}

/**
 * Recent-call-frequency score, 0..1, higher means less recently used. Purely a soft
 * preference signal (spreads load) — never excludes a candidate; hard limit
 * enforcement is `isOrchestratorCandidateAllowed` (task 3, budget.ts), a separate
 * concern from scoring.
 */
function rateLimitScore(routerId: string, callCounts: Map<string, number>): number {
  const count = callCounts.get(routerId) ?? 0;
  if (count === 0) return 1.0;
  const counts = [...callCounts.values()];
  const minCount = Math.min(...counts.filter(c => c > 0));
  return Math.max(0, Math.min(1, minCount / count));
}

/** Fairness share score, 0..1: 1 - (own share of total recent successful calls). */
function fairnessScore(routerId: string, successCounts: Map<string, number>, totalSuccessCalls: number): number {
  if (totalSuccessCalls === 0) return 1.0;
  const count = successCounts.get(routerId) ?? 0;
  return Math.max(0, Math.min(1, 1 - count / totalSuccessCalls));
}

/**
 * Orders an Orchestrator's candidate Routers by a weight/health/rate-limit/fairness
 * blend, most-preferred first. Adapts the *shape* of the plain-Router policy pipeline
 * (`router.ts`'s `scoreCandidates`/`routeRequest`, and the `health`/`rate-limit`/
 * `fairness` policies it wires in) to a candidate whose only signals are its own
 * configured `weight` plus usage-derived health/recent-call-rate/fairness-share —
 * keyed by `routerId` instead of `modelId`. Deliberately never invokes any
 * model-only policy (`context`/`capability`/`cheapest`/`llm`/`performance`/
 * `budget-remaining`/`semantic-intent`/`model-preference`): those are structurally
 * about a model's context window, capabilities or price, none of which a Router
 * candidate has of its own. This is true by construction — this function simply
 * never imports or calls them, not "invoked but no-op" (AC8).
 *
 * EC3 (read-side defense): a candidate is silently dropped, never throws, when its
 * `routerId` no longer resolves in `liveRouters` to a router of kind `'router'` — the
 * target may have been deleted, or repointed to another kind, since the Orchestrator's
 * candidate list was saved.
 *
 * Returns every surviving candidate ordered most-preferred first — an empty array
 * when no candidate survives. Health/rate-limit/fairness are the primary ranking
 * signal; when two candidates tie on that (e.g. no usage history yet), the
 * configured `weight` breaks the tie (higher first), and `routerId` breaks any
 * remaining tie, for a fully deterministic order (AC8). Task 3's `forwardToRouter`
 * consumes this array by trying candidates in order, falling back down the list.
 */
export async function scoreOrchestratorCandidates(
  orchestratorId: string,
  candidates: OrchestratorCandidateRef[],
  liveRouters: RouterConfig[],
): Promise<OrchestratorCandidateRef[]> {
  const liveRouterKind = new Map(liveRouters.map(r => [r.id, r.kind ?? 'router']));
  const valid = candidates.filter(c => liveRouterKind.get(c.routerId) === 'router');
  if (valid.length <= 1) return valid;

  const now = Date.now();
  const records = await readUsageRecords();
  const forThisOrchestrator = records.filter(r => r.orchestratorId === orchestratorId);

  const callCounts = new Map<string, number>();
  const successCounts = new Map<string, number>();
  for (const candidate of valid) {
    const ownRecords = forThisOrchestrator.filter(r => r.routerId === candidate.routerId);
    callCounts.set(candidate.routerId, ownRecords.filter(r => now - new Date(r.timestamp).getTime() <= RATE_LIMIT_WINDOW_MS).length);
    successCounts.set(
      candidate.routerId,
      ownRecords.filter(r => r.outcome === 'success' && now - new Date(r.timestamp).getTime() <= FAIRNESS_WINDOW_MS).length,
    );
  }
  const totalSuccessCalls = [...successCounts.values()].reduce((sum, n) => sum + n, 0);

  const scored = valid.map(candidate => {
    const ownRecords = forThisOrchestrator.filter(r => r.routerId === candidate.routerId);
    const health = healthScore(ownRecords, now);
    const rateLimit = rateLimitScore(candidate.routerId, callCounts);
    const fairness = fairnessScore(candidate.routerId, successCounts, totalSuccessCalls);
    return { candidate, quality: (health + rateLimit + fairness) / 3 };
  });

  scored.sort((a, b) => {
    if (Math.abs(a.quality - b.quality) >= 0.0001) return b.quality - a.quality;
    if (a.candidate.weight !== b.candidate.weight) return b.candidate.weight - a.candidate.weight;
    return a.candidate.routerId.localeCompare(b.candidate.routerId);
  });

  return scored.map(s => s.candidate);
}
