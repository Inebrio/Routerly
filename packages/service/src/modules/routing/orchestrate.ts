import type { ChatCompletionRequest, OrchestratorCandidateRef, RouterConfig, RoutingPolicy, UsageRecord } from '@routerly/shared';
import type { ProcessorRegistry } from '../../core/index.js';
import type { ProxyContext } from '../reverse-proxy/context.js';
import { readUsageRecords } from '../usage/usageStore.js';
import { readConfig } from '../config/loader.js';
import { isOrchestratorCandidateAllowed } from '../budget/budget.js';
import { runCandidateLoop } from '../reverse-proxy/candidate-loop.js';
import { scoreCandidates } from './router.js';
import { resolveRoutingProfile } from './profiles/store.js';

// Same policy types, same config keys and defaults as the plain-Router policies these
// are adapted from (health.ts, rate-limit.ts, fairness.ts) — the Orchestrator's own
// `policies` array drives them exactly like a Router's does, just keyed by routerId
// instead of modelId. `enabled` defaults to true when the type is absent from the
// array, so an Orchestrator with no policies configured keeps today's always-on blend.
function findPolicy(policies: RoutingPolicy[] | undefined, type: RoutingPolicy['type']) {
  return policies?.find(p => p.type === type);
}

/** Policy types that pick among a *pool of models*, never among candidate Routers themselves. */
const MODEL_ATTRIBUTE_POLICY_TYPES = new Set([
  'cheapest', 'capability', 'context', 'performance', 'llm', 'semantic-intent', 'model-preference', 'budget-remaining',
]);

/**
 * Delegates to the candidate Router's own `scoreCandidates` pipeline (unmodified — same
 * function a direct call to that Router runs) so its own cheapest/capability/llm/performance/
 * context/semantic-intent/model-preference policies, configured on *that* Router, decide how
 * good a deal it currently offers. Returns the candidate's best resolvable model score (0..1),
 * or `undefined` when the candidate has no model-attribute policy enabled on its own profile —
 * callers must skip the signal entirely in that case rather than treat it as a low score, and
 * this doubles as the cost/latency guard: a candidate that only relies on health/rate-limit/
 * fairness never pays for a second policy pipeline run.
 */
async function candidateModelPolicyScore(request: ChatCompletionRequest, router: RouterConfig): Promise<number | undefined> {
  if (router.models.length === 0) return undefined;
  const profile = await resolveRoutingProfile(router);
  if (!profile.policies.some(p => p.enabled && MODEL_ATTRIBUTE_POLICY_TYPES.has(p.type))) return undefined;
  try {
    const result = await scoreCandidates(request, router, profile);
    if (result.bypass) return 1.0; // single resolvable model, no discriminating policy needed
    if (result.scored.length === 0) return undefined;
    return Math.max(...result.scored.map(s => s.score));
  } catch {
    // Candidate's own pipeline failed (e.g. no_models_available) — no signal, not a penalty.
    return undefined;
  }
}

/** Error-rate score, 0..1, higher is healthier. No recent records -> 1.0 (no signal yet). */
function healthScore(ownRecords: UsageRecord[], now: number, config: Record<string, unknown> | undefined): number {
  const windowMs = ((config?.windowMinutes as number) ?? 20) * 60 * 1000;
  const halfLifeMs = ((config?.halfLifeMinutes as number) ?? 5) * 60 * 1000;
  const pseudoCounts = (config?.pseudoCounts as number) ?? 2;
  const circuitBreaker = (config?.circuitBreaker as number) ?? 0.9;

  const recent = ownRecords.filter(r => now - new Date(r.timestamp).getTime() <= windowMs && r.outcome !== 'blocked');
  if (recent.length === 0) return 1.0;

  let weightedErrors = 0;
  let weightedTotal = 0;
  for (const r of recent) {
    const ageMs = now - new Date(r.timestamp).getTime();
    const weight = Math.exp((-Math.LN2 * ageMs) / halfLifeMs);
    const isError = r.outcome === 'error' || r.outcome === 'timeout';
    weightedErrors += isError ? weight : 0;
    weightedTotal += weight;
  }

  const rawWeightedErrorRate = weightedErrors / weightedTotal;
  const smoothedErrorRate = weightedErrors / (weightedTotal + pseudoCounts);
  const score = rawWeightedErrorRate >= circuitBreaker ? 0.0 : 1 - smoothedErrorRate;
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
 * keyed by `routerId` instead of `modelId`. Each of those three signals is driven by
 * the Orchestrator's own `policies` array exactly like a Router's `health`/`rate-limit`/
 * `fairness` policies drive `scoreCandidates` — same config keys, same defaults, and
 * `enabled: false` drops that signal from the blend entirely.
 *
 * The model-attribute policy types (`cheapest`/`capability`/`context`/`performance`/`llm`/
 * `semantic-intent`/`model-preference`/`budget-remaining`) aren't reinterpreted for a Router
 * candidate — a router has no price or context window of its own. Instead each candidate is
 * asked, via `candidateModelPolicyScore`, what its *own* configured policies (the same
 * `policies` array a direct call to that Router would run, untouched) resolve to right now;
 * that resolved score joins the blend as one more signal, only for candidates that actually
 * enable one of those types on their own profile (AC8 still holds: zero policy-file changes,
 * and a candidate using none of them costs nothing extra).
 *
 * EC3 (read-side defense): a candidate is silently dropped, never throws, when its
 * `routerId` no longer resolves in `liveRouters` to a router of kind `'router'` — the
 * target may have been deleted, or repointed to another kind, since the Orchestrator's
 * candidate list was saved.
 *
 * Returns every surviving candidate ordered most-preferred first — an empty array
 * when no candidate survives. Health/rate-limit/fairness are the primary ranking
 * signal; when two candidates tie on that (e.g. no usage history yet, or every signal
 * disabled), the configured `weight` breaks the tie (higher first), and `routerId`
 * breaks any remaining tie, for a fully deterministic order (AC8). Task 3's
 * `forwardToRouter` consumes this array by trying candidates in order, falling back
 * down the list.
 */
export async function scoreOrchestratorCandidates(
  orchestratorId: string,
  candidates: OrchestratorCandidateRef[],
  liveRouters: RouterConfig[],
  policies?: RoutingPolicy[],
  request?: ChatCompletionRequest,
): Promise<OrchestratorCandidateRef[]> {
  const liveRouterKind = new Map(liveRouters.map(r => [r.id, r.kind ?? 'router']));
  const liveRouterById = new Map(liveRouters.map(r => [r.id, r]));
  const valid = candidates.filter(c => liveRouterKind.get(c.routerId) === 'router');
  if (valid.length <= 1) return valid;

  const healthPolicy = findPolicy(policies, 'health');
  const rateLimitPolicy = findPolicy(policies, 'rate-limit');
  const fairnessPolicy = findPolicy(policies, 'fairness');
  const healthEnabled = healthPolicy?.enabled ?? true;
  const rateLimitEnabled = rateLimitPolicy?.enabled ?? true;
  const fairnessEnabled = fairnessPolicy?.enabled ?? true;
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

  const modelPolicyScores = request
    ? new Map(
        await Promise.all(
          valid.map(async candidate => {
            const target = liveRouterById.get(candidate.routerId);
            const score = target ? await candidateModelPolicyScore(request, target) : undefined;
            return [candidate.routerId, score] as const;
          }),
        ),
      )
    : new Map<string, number | undefined>();

  const scored = valid.map(candidate => {
    const ownRecords = forThisOrchestrator.filter(r => r.routerId === candidate.routerId);
    const signals: number[] = [];
    if (healthEnabled) signals.push(healthScore(ownRecords, now, healthPolicy?.config));
    if (rateLimitEnabled) signals.push(rateLimitScore(candidate.routerId, callCounts));
    if (fairnessEnabled) signals.push(fairnessScore(candidate.routerId, successCounts, totalSuccessCalls));
    const modelPolicyScore = modelPolicyScores.get(candidate.routerId);
    if (modelPolicyScore !== undefined) signals.push(modelPolicyScore);
    const quality = signals.length > 0 ? signals.reduce((a, b) => a + b, 0) / signals.length : 1.0;
    return { candidate, quality };
  });

  scored.sort((a, b) => {
    if (Math.abs(a.quality - b.quality) >= 0.0001) return b.quality - a.quality;
    if (a.candidate.weight !== b.candidate.weight) return b.candidate.weight - a.candidate.weight;
    return a.candidate.routerId.localeCompare(b.candidate.routerId);
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
  const ordered = await scoreOrchestratorCandidates(orchestrator.id, orchestrator.candidates ?? [], liveRouters, orchestrator.policies, ctx.request);

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
