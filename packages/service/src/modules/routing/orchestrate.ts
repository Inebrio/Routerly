import type { OrchestratorCandidateRef, RouterConfig, RoutingPolicy, UsageRecord } from '@routerly/shared';
import type { ProcessorRegistry } from '../../core/index.js';
import type { ProxyContext } from '../reverse-proxy/context.js';
import { readUsageRecords } from '../usage/usageStore.js';
import { readConfig } from '../config/loader.js';
import { isOrchestratorCandidateAllowed, getOrchestratorCandidateLimitSnapshot, type LimitSnapshot } from '../budget/budget.js';
import { runCandidateLoop } from '../reverse-proxy/candidate-loop.js';
import { decayWeightedErrorScore, decayWeightedLatencyAverage, relativeLatencyScore, ratioScore, shareScore } from './policies/scoring.js';

// Same policy types, same config keys and defaults as the plain-Router policies these
// are adapted from (health.ts, rate-limit.ts, fairness.ts, performance.ts, and the
// headroom math behind budget-remaining.ts) — the Orchestrator's own `policies` array
// drives them exactly like a Router's does, just keyed by routerId instead of modelId.
// `enabled` defaults to true when the type is absent from the array, so an Orchestrator
// with no policies configured keeps today's always-on blend.
function findPolicy(policies: RoutingPolicy[] | undefined, type: RoutingPolicy['type']) {
  return policies?.find(p => p.type === type);
}

/** Error-rate score, 0..1, higher is healthier. No recent records -> 1.0 (no signal yet). */
function healthScore(ownRecords: UsageRecord[], now: number, config: Record<string, unknown> | undefined): number {
  const windowMs = ((config?.windowMinutes as number) ?? 20) * 60 * 1000;
  const halfLifeMs = ((config?.halfLifeMinutes as number) ?? 5) * 60 * 1000;
  const pseudoCounts = (config?.pseudoCounts as number) ?? 2;
  const circuitBreaker = (config?.circuitBreaker as number) ?? 0.9;

  const recent = ownRecords.filter(r => now - new Date(r.timestamp).getTime() <= windowMs && r.outcome !== 'blocked');
  return decayWeightedErrorScore(recent, now, halfLifeMs, pseudoCounts, circuitBreaker).point;
}

/**
 * Decay-weighted average latency for one candidate's own records against this
 * Orchestrator (AC4) — never the candidate Router's own global model-level usage.
 * Records outside the window, or with an error/timeout outcome, or a non-positive
 * latency, are excluded (same filtering `performance.ts` applies model-side).
 * Returns `null` below `minSamples`; `relativeLatencyScore` treats `null` as "no
 * signal yet" (neutral 1.0, EC1), same convention as the other three signals.
 */
function performanceScore(ownRecords: UsageRecord[], now: number, config: Record<string, unknown> | undefined): number | null {
  const windowMs = ((config?.windowMinutes as number) ?? 20) * 60 * 1000;
  const halfLifeMinutes = (config?.halfLifeMinutes as number) ?? 5;
  const halfLifeMs = halfLifeMinutes * 60 * 1000;
  const minSamples = (config?.minSamples as number) ?? 1;

  const recent = ownRecords.filter(r =>
    now - new Date(r.timestamp).getTime() <= windowMs &&
    r.outcome !== 'error' && r.outcome !== 'timeout' && r.latencyMs > 0,
  );
  if (recent.length < minSamples) return null;
  return decayWeightedLatencyAverage(recent, now, halfLifeMinutes > 0 ? halfLifeMs : 0);
}

/**
 * Min-headroom-across-limits for one candidate's own configured `limits` (AC5) — a
 * *soft* signal only. A candidate with no `limits` configured at all gets full
 * headroom (1.0, neutral) here (AC6); it is never excluded or penalized by this
 * score. Exclusion, when it happens, is `isOrchestratorCandidateAllowed`'s hard
 * gate — called independently in `forwardToRouter`, before/regardless of this
 * score (EC3) — never re-implemented here.
 */
function budgetRemainingScore(snapshots: LimitSnapshot[]): number {
  if (snapshots.length === 0) return 1.0;
  const minHeadroom = snapshots.reduce((min, s) => Math.min(min, s.value > 0 ? s.remaining / s.value : 1.0), 1.0);
  return Math.max(0, Math.min(1, minHeadroom));
}

/**
 * Orders an Orchestrator's candidate Routers by a priority-position/health/rate-limit/
 * fairness/performance/budget-remaining blend, most-preferred first. Adapts the
 * *shape* of the plain-Router policy pipeline (`router.ts`'s
 * `scoreCandidates`/`routeRequest`, and the `health`/`rate-limit`/`fairness`/
 * `performance`/`budget-remaining` policies it wires in) to a candidate whose only
 * signals are its own position in the input `candidates` array plus usage-derived
 * health/recent-call-rate/fairness-share/latency/budget-headroom — keyed by
 * `routerId` instead of `modelId`. Each of those five signals is driven by the
 * Orchestrator's own `policies` array exactly like a Router's own policies drive
 * `scoreCandidates` — same config keys, same defaults, and `enabled: false` drops that
 * signal from the blend entirely. Deliberately never invokes any policy that is
 * structurally about a model's context window, capabilities or price
 * (`context`/`capability`/`cheapest`/`llm`/`semantic-intent`/`model-preference`), none
 * of which a Router candidate has of its own. This is true by construction — this
 * function simply never imports or calls them, not "invoked but no-op" (AC8).
 *
 * EC3 (read-side defense): a candidate is silently dropped, never throws, when its
 * `routerId` no longer resolves in `liveRouters` to a router of kind `'router'` — the
 * target may have been deleted, or repointed to another kind, since the Orchestrator's
 * candidate list was saved.
 *
 * Returns every surviving candidate ordered most-preferred first — an empty array
 * when no candidate survives. The health/rate-limit/fairness/performance/
 * budget-remaining blend is the primary ranking signal; when two candidates tie on
 * that (e.g. no usage history yet, or every signal disabled), the candidate's index
 * in the input array breaks the tie — earlier position (i.e. drag order) wins (AC3)
 * — which is always unique across the filtered array, so no further tie-break is
 * needed for a fully deterministic order (AC8). Task 3's `forwardToRouter` consumes
 * this array by trying candidates in order, falling back down the list.
 */
export async function scoreOrchestratorCandidates(
  orchestratorId: string,
  candidates: OrchestratorCandidateRef[],
  liveRouters: RouterConfig[],
  policies?: RoutingPolicy[],
): Promise<OrchestratorCandidateRef[]> {
  const liveRouterKind = new Map(liveRouters.map(r => [r.id, r.kind ?? 'router']));
  const valid = candidates.filter(c => liveRouterKind.get(c.routerId) === 'router');
  if (valid.length <= 1) return valid;

  const healthPolicy = findPolicy(policies, 'health');
  const rateLimitPolicy = findPolicy(policies, 'rate-limit');
  const fairnessPolicy = findPolicy(policies, 'fairness');
  const performancePolicy = findPolicy(policies, 'performance');
  const budgetRemainingPolicy = findPolicy(policies, 'budget-remaining');
  const healthEnabled = healthPolicy?.enabled ?? true;
  const rateLimitEnabled = rateLimitPolicy?.enabled ?? true;
  const fairnessEnabled = fairnessPolicy?.enabled ?? true;
  const performanceEnabled = performancePolicy?.enabled ?? true;
  const budgetRemainingEnabled = budgetRemainingPolicy?.enabled ?? true;
  const rateLimitWindowMs = ((rateLimitPolicy?.config?.windowMinutes as number) ?? 1) * 60 * 1000;
  const fairnessWindowMs = ((fairnessPolicy?.config?.windowMinutes as number) ?? 60) * 60 * 1000;

  const now = Date.now();
  const records = await readUsageRecords();
  const forThisOrchestrator = records.filter(r => r.orchestratorId === orchestratorId);

  const callCounts = new Map<string, number>();
  const successCounts = new Map<string, number>();
  for (const candidate of valid) {
    const ownRecords = forThisOrchestrator.filter(r => r.routerId === candidate.routerId);
    callCounts.set(candidate.routerId, ownRecords.filter(r => now - new Date(r.timestamp).getTime() <= rateLimitWindowMs).length);
    successCounts.set(
      candidate.routerId,
      ownRecords.filter(r => r.outcome === 'success' && now - new Date(r.timestamp).getTime() <= fairnessWindowMs).length,
    );
  }
  const totalSuccessCalls = [...successCounts.values()].reduce((sum, n) => sum + n, 0);
  const positiveCallCounts = [...callCounts.values()].filter(c => c > 0);
  const minCallCount = positiveCallCounts.length > 0 ? Math.min(...positiveCallCounts) : 0;

  // Both need a cross-candidate view before per-candidate scoring: latency is a relative
  // comparison across the whole pool (same as performance.ts model-side), and the budget
  // snapshot is an async per-candidate read (same as isOrchestratorCandidateAllowed).
  const performanceScores = performanceEnabled
    ? relativeLatencyScore(valid.map(c => performanceScore(forThisOrchestrator.filter(r => r.routerId === c.routerId), now, performancePolicy?.config)))
    : [];
  const budgetSnapshots = budgetRemainingEnabled
    ? await Promise.all(valid.map(c => getOrchestratorCandidateLimitSnapshot(orchestratorId, c)))
    : [];

  const scored = valid.map((candidate, index) => {
    const ownRecords = forThisOrchestrator.filter(r => r.routerId === candidate.routerId);
    const signals: number[] = [];
    if (healthEnabled) signals.push(healthScore(ownRecords, now, healthPolicy?.config));
    if (rateLimitEnabled) signals.push(ratioScore(callCounts.get(candidate.routerId) ?? 0, minCallCount));
    if (fairnessEnabled) signals.push(shareScore(successCounts.get(candidate.routerId) ?? 0, totalSuccessCalls));
    if (performanceEnabled) signals.push(performanceScores[index]!);
    if (budgetRemainingEnabled) signals.push(budgetRemainingScore(budgetSnapshots[index] ?? []));
    const quality = signals.length > 0 ? signals.reduce((a, b) => a + b, 0) / signals.length : 1.0;
    return { candidate, quality, index };
  });

  scored.sort((a, b) => {
    if (Math.abs(a.quality - b.quality) >= 0.0001) return b.quality - a.quality;
    return a.index - b.index; // AC3: earlier position in the input array wins the tie, always unique
  });

  return scored.map(s => s.candidate);
}

/**
 * Sets `ctx.result` to a routing-failure error in the calling lane's own wire shape (EC1) —
 * never a silent fallback to any direct model call, and never a bare throw reaching Fastify.
 * Mirrors the exhaustion shape each lane's own model-attempt loop already produces
 * (`anthropicAttempt`/`openaiAttempt`), scoped to "candidate routers" instead of "candidate
 * models" since that is what actually ran out here.
 */
function setOrchestratorExhausted(ctx: ProxyContext): void {
  if (ctx.protocol === 'anthropic') {
    ctx.result = {
      kind: 'block', status: 503,
      body: { type: 'error', error: { type: 'overloaded_error', message: 'All orchestrator candidate routers are budget-exhausted or unavailable.' } },
    };
    return;
  }
  if (ctx.stream) {
    const errChunk = { id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: ctx.request.model ?? '', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    ctx.result = { kind: 'stream', body: (async function* () { yield errChunk })() };
    return;
  }
  ctx.result = { kind: 'block', status: 503, body: { error: { message: 'All orchestrator candidate routers failed or are budget-exhausted.', type: 'server_error' } } };
}

/**
 * Forwards a request through an Orchestrator to its best available candidate Router (task 3,
 * AC2/AC5/AC6/EC1/EC3). Scores candidates with `scoreOrchestratorCandidates`, then tries each in
 * order via the shared `runCandidateLoop` (same mechanism the plain-Router model loop uses):
 * for each candidate, `isOrchestratorCandidateAllowed` (AC6 — the Orchestrator's own budget gate,
 * entirely separate from the candidate Router's own independent limit) gates the attempt, then
 * the request is forwarded by re-running the *same* `routing.prepare`/`routing.execute` phases
 * the candidate Router would run for a direct call — not a shortcut copy of that logic — by
 * temporarily pointing `ctx.router`/`ctx.routerId` at the candidate and letting the existing
 * `anthropicAttempt`/`openaiAttempt` (itself registered on `routing.execute`) run the plain-Router
 * model loop against it. That loop's own terminal 503 (all of *that* Router's models exhausted)
 * is a per-candidate failure signal here, not a response to return — it is cleared and the next
 * Orchestrator candidate is tried. `ctx.orchestratorId` is set for the duration so the lanes'
 * `cctx` construction threads it into `trackUsage` (AC5).
 *
 * A candidate whose target no longer resolves to a live Router of kind `'router'` — deleted or
 * repointed since `scoreOrchestratorCandidates` read the router list — or whose forward attempt
 * throws for any other reason, is treated exactly like any other candidate failure: skipped, next
 * candidate tried (EC3). Exhausting every candidate sets a routing-failure `ctx.result`, never a
 * fallback to any direct model call (EC1).
 */
export async function forwardToRouter(
  orchestrator: RouterConfig,
  ctx: ProxyContext,
  pipeline: ProcessorRegistry<ProxyContext>,
): Promise<void> {
  const liveRouters = await readConfig('routers');
  const liveById = new Map(liveRouters.map(r => [r.id, r]));
  const ordered = await scoreOrchestratorCandidates(orchestrator.id, orchestrator.candidates ?? [], liveRouters, orchestrator.policies);

  ctx.orchestratorId = orchestrator.id;

  await runCandidateLoop(ordered, async (candidate) => {
    const target = liveById.get(candidate.routerId);
    if (!target || (target.kind ?? 'router') !== 'router') return false; // EC3: gone/repointed since scoring
    if (!(await isOrchestratorCandidateAllowed(orchestrator.id, candidate))) return false; // AC6

    const savedRouter = ctx.router;
    const savedRouterId = ctx.routerId;
    ctx.router = target;
    ctx.routerId = target.id;
    try {
      await pipeline.runPhase('routing.prepare', ctx);
      if (!ctx.result) await pipeline.runPhase('routing.execute', ctx);
    } catch {
      // Never let one candidate Router's failure (e.g. its own no_models_available) reach
      // the client unhandled — same "skip, try next" contract as every other candidate fault.
      delete ctx.result;
      return false;
    } finally {
      ctx.router = savedRouter;
      ctx.routerId = savedRouterId;
    }

    if (ctx.result?.kind === 'block') {
      // This candidate Router exhausted its own models — a per-candidate failure from the
      // Orchestrator's point of view, not a response to return. Try the next candidate.
      delete ctx.result;
      return false;
    }
    return ctx.result !== undefined; // success: json / stream / passthrough, byte-identical (AC2)
  }, () => setOrchestratorExhausted(ctx), { presorted: true }); // `ordered` is already quality-ranked — don't let the loop re-sort by raw weight
}
