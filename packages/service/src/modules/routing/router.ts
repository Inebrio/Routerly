import { DEFAULT_RANKING_ALGORITHM, PASSTHROUGH_MODEL_ID, type ChatCompletionRequest, type ModelConfig, type RouterConfig, type RouterToken, type ResilienceStore, type RankingAlgorithmId, type RoutingCandidate, type RoutingProfile } from '@routerly/shared';
import { listEffectiveModels } from '../provider/list-effective.js';
import { isAllowed, getViolatedLimits } from '../budget/budget.js';
import type { LimitSnapshot } from '../budget/budget.js';
import { filterAvailable } from '../resilience/filter.js';
import type { CandidateModel } from './policies/types.js';
import { contextPolicy } from './policies/context.js';
import { cheapestPolicy } from './policies/cheapest.js';
import { healthPolicy } from './policies/health.js';
import { performancePolicy } from './policies/performance.js';
import { llmPolicy } from './policies/llm.js';
import { capabilityPolicy } from './policies/capability.js';
import { rateLimitPolicy } from './policies/rate-limit.js';
import { fairnessPolicy } from './policies/fairness.js';
import { budgetRemainingPolicy } from './policies/budget-remaining.js';
import { semanticIntentPolicy } from './policies/semantic-intent.js';
import { modelPreferencePolicy } from './policies/model-preference.js';
import type { PolicyFn } from './policies/types.js';
import type { TraceEntry } from '@routerly/shared';
import type { TracePanel } from '../trace/store.js';
import { CUSTOM_PROFILE_ID, resolveRoutingProfile } from './profiles/store.js';
import { RANKING_MAP, resolveRankingAlgorithm } from './ranking/index.js';
import { callConfigTraceDetails, decideCallTier, pickCallConfig, type CallDecision } from './call-config.js';

function te(panel: TracePanel, message: string, details: Record<string, unknown>): TraceEntry {
  return { panel, message, details };
}

export interface RouteResult {
  models: RoutingCandidate[];
  trace: TraceEntry[];
  /** Present only when the resolved call configuration is enabled. */
  callDecision?: CallDecision;
}

type Logger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
};

const POLICY_MAP: Record<string, PolicyFn> = {
  context: contextPolicy,
  cheapest: cheapestPolicy,
  health: healthPolicy,
  performance: performancePolicy,
  llm: llmPolicy,
  capability: capabilityPolicy,
  'rate-limit': rateLimitPolicy,
  fairness: fairnessPolicy,
  'budget-remaining': budgetRemainingPolicy,
  'semantic-intent': semanticIntentPolicy,
  'model-preference': modelPreferencePolicy,
};

/**
 * Result of the pre-selector scoring pipeline, extracted from routeRequest so the
 * simulate endpoint can reuse the exact same policy scoring without forwarding. When
 * `bypass` is set, only one valid candidate existed and scoring never ran: the caller
 * must return `bypass` verbatim (all other fields are placeholder empties in that case).
 */
export interface ScoringResult {
  scoringCandidates: CandidateModel[];
  rankingAlgorithm: RankingAlgorithmId;
  successfulResults: { type: string; weight: number; routing: { model: string; point: number }[] }[];
  scoringIds: Set<string>;
  policyExcludes: Set<string>;
  excludeReasons: Map<string, string[]>;
  failedPolicies: { type: string; error: string | undefined }[];
  /** Prefix trace: resilience?, intake, policies, profile, per-policy results (matches routeRequest's returned trace before recap/result). */
  trace: TraceEntry[];
  bypass?: RouteResult;
}

export async function scoreCandidates(
  request: ChatCompletionRequest,
  router: RouterConfig,
  profile: RoutingProfile,
  log?: Logger,
  emit?: (entry: TraceEntry) => void,
  token?: RouterToken,
  traceId?: string,
  conversationId?: string,
  store?: ResilienceStore,
): Promise<ScoringResult> {
  const enabledPolicies = profile.policies.filter(p => p.enabled);

  // Peso posizionale per rank: la policy in posizione 1 vale N volte,
  // l'ultima vale 1. Formula: weight = total - idx (rank decrescente).
  // Nessuna costante hardcoded: il rapporto max:min cresce con N,
  // riflettendo naturalmente l'intenzione dell'utente nell'ordinarle.
  // Con 1 policy: weight=1. Con 3: 3,2,1. Con 5: 5,4,3,2,1.
  const total = enabledPolicies.length;
  const policiesWithWeight = enabledPolicies.map((p, idx) => ({
    position: idx + 1,
    type: p.type,
    weight: total - idx,
    config: p.config,
  }));

  // Carica i ModelConfig completi per i modelli associati al progetto
  // routing must only consider models on enabled connections
  const allModels: ModelConfig[] = await listEffectiveModels();
  const missingModelIds: string[] = [];
  let candidates: CandidateModel[] = router.models
    .filter(ref => ref.modelId !== PASSTHROUGH_MODEL_ID)
    .map(ref => {
      const model = allModels.find(m => m.id === ref.modelId);
      if (!model) {
        missingModelIds.push(ref.modelId);
        return null;
      }
      return { model, ...(ref.prompt !== undefined ? { prompt: ref.prompt } : {}), ...(ref.thresholds !== undefined ? { thresholds: ref.thresholds } : {}) };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (missingModelIds.length > 0) {
    log?.warn(
      { routerId: router.id, missingModelIds },
      'routing: router references models not found in registry',
    );
  }

  if (candidates.length === 0) {
    // Message prefix `no_models_available` is pattern-matched by routing/index.ts's
    // passthrough fallback branch — reword it there too, or the fallback stops firing.
    throw new Error(`no_models_available: router has no resolvable models (referenced: [${router.models.map(m => m.modelId).join(', ')}])`);
  }

  // ── Pre-filtro resilienza ────────────────────────────────────────────────
  // Esclude i candidati il cui circuito provider/connection/model è aperto,
  // in cooldown o in lockout, prima ancora del controllo limiti. store è
  // opzionale (container-resolved un livello sopra): se assente, nessun filtro.
  let resilienceTraceEntry: TraceEntry | undefined;
  if (store) {
    const { available, excluded } = filterAvailable(candidates, store);
    candidates = available;
    if (excluded.length > 0) {
      resilienceTraceEntry = te('router-request', 'resilience:excluded', { excluded });
      emit?.(resilienceTraceEntry);
    }
  }

  // ── Pre-filtro limiti ────────────────────────────────────────────────────
  // Esclude i modelli che hanno già superato uno o più limiti prima di
  // coinvolgere qualunque policy, così alle policy arrivano solo candidati
  // ancora validi.
  type LimitExclusion = { modelId: string; violated: LimitSnapshot[] };
  const excludedByLimits: LimitExclusion[] = [];
  const validCandidates: CandidateModel[] = [];

  await Promise.all(
    candidates.map(async (c) => {
      const allowed = await isAllowed(c.model, router, token);
      if (!allowed) {
        const violated = await getViolatedLimits(c.model, router, token);
        excludedByLimits.push({ modelId: c.model.id, violated });
      } else {
        validCandidates.push(c);
      }
    }),
  );

  if (excludedByLimits.length > 0) {
    for (const exc of excludedByLimits) {
      log?.info(
        {
          modelId: exc.modelId,
          violated: exc.violated.map(v => ({
            metric: v.metric,
            window: v.window,
            limit: v.value,
            current: v.current,
            remaining: v.remaining,
          })),
        },
        'routing: model excluded — limit exceeded',
      );
    }
  }

  if (validCandidates.length === 0) {
    // Message `all_models_limits_exceeded` is pattern-matched by routing/index.ts's
    // passthrough fallback branch — reword it there too, or the fallback stops firing.
    throw new Error('all_models_limits_exceeded');
  }

  // ── Emit intake subito ────────────────────────────────────────────────────
  const intakeEntry = te('router-request', 'router:intake', {
    model: request.model,
    messageCount: request.messages?.length ?? 0,
    routerId: router.id,
    ...(excludedByLimits.length > 0
      ? {
          excludedByLimits: excludedByLimits.map(e => ({
            model: e.modelId,
            violated: e.violated.map(v => ({
              metric: v.metric,
              window: v.window,
              limit: v.value,
              current: v.current,
              remaining: v.remaining,
            })),
          })),
        }
      : {}),
  });
  emit?.(intakeEntry);

  // ── Bypass diretto se rimane un solo candidato valido ────────────────────
  if (validCandidates.length === 1) {
     
    const only = validCandidates[0]!;
    log?.info(
      { modelId: only.model.id, totalCandidates: candidates.length },
      'routing: single valid model — bypassing policies, forwarding directly',
    );
    const singleResult: RoutingCandidate = { model: only.model.id, weight: 1, ...(only.prompt ? { prompt: only.prompt } : {}) };
    const bypassEntry = te('router-response', 'router:result', {
      final: [{ model: singleResult.model, weight: singleResult.weight, hasPrompt: !!singleResult.prompt }],
      note: 'single_candidate_bypass',
    });
    emit?.(bypassEntry);
    const bypass: RouteResult = {
      models: [singleResult],
      trace: [...(resilienceTraceEntry ? [resilienceTraceEntry] : []), intakeEntry, bypassEntry],
    };
    return {
      scoringCandidates: [],
      rankingAlgorithm: DEFAULT_RANKING_ALGORITHM,
      successfulResults: [],
      scoringIds: new Set(),
      policyExcludes: new Set(),
      excludeReasons: new Map(),
      failedPolicies: [],
      trace: bypass.trace,
      bypass,
    };
  }

  // ── Emit policy config subito dopo ───────────────────────────────────────
  // Redact sensitive fields (API keys, tokens, secrets) from the trace.
  const redactConfig = (cfg: unknown): unknown => {
    if (!cfg || typeof cfg !== 'object') return cfg;
    if (Array.isArray(cfg)) return cfg.map(redactConfig);
    return Object.fromEntries(
      Object.entries(cfg as Record<string, unknown>).map(([k, v]) => {
        if (/key|secret|token|password/i.test(k)) return [k, '***'];
        if (v && typeof v === 'object') return [k, redactConfig(v)];
        return [k, v];
      }),
    );
  };
  const policiesEntry = te('router-request', 'router:policies', {
    policies: policiesWithWeight.map(({ type, weight, config }) => ({ type, weight, config: redactConfig(config) })),
    candidates: validCandidates.map(c => c.model.id),
  });
  emit?.(policiesEntry);

  const rankingAlgorithm = resolveRankingAlgorithm(profile.rankingAlgorithm, log);
  const profileEntry = te('router-request', 'router:profile', {
    profileId: profile.id,
    selector: profile.selector,
    fallbackStrategy: profile.fallbackStrategy,
    rankingAlgorithm,
  });
  emit?.(profileEntry);

  // ── Esegue le policy in parallelo ─────────────────────────────────────────
  const policyResults = await Promise.all(
    policiesWithWeight.map(async ({ type, weight, config }) => {
      const fn = POLICY_MAP[type];
      if (!fn) {
        log?.info({ type }, 'routing: unknown policy type, skipping');
        return { type, weight, routing: [] as { model: string; point: number }[], excludes: [] as string[], failed: true, error: 'unknown policy type' };
      }
      try {
        const out = await fn({ request, candidates: validCandidates, config, ...(log !== undefined ? { log } : {}), ...(emit !== undefined ? { emit } : {}), routerId: router.id, ...(token !== undefined ? { token } : {}), ...(traceId !== undefined ? { traceId } : {}), ...(conversationId !== undefined ? { conversationId } : {}) });
        return { type, weight, routing: out.routing, excludes: out.excludes ?? [], failed: false, error: undefined as string | undefined };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.info({ type, err: errMsg }, 'routing: policy failed');
        emit?.(te('router-response', `policy:error:${type}`, { type, error: errMsg }));
        return { type, weight, routing: [] as { model: string; point: number }[], excludes: [] as string[], failed: true, error: errMsg };
      }
    }),
  );

  // A failed policy is dropped from the scoring (fail-open: the request is still served), but
  // never silently: say it in the trace and the log.
  const failedPolicies = policyResults.filter(r => r.failed);
  if (failedPolicies.length > 0) {
    log?.warn({ failed: failedPolicies.map(r => r.type) }, 'routing: policies failed, selection is not guided by them');
    emit?.(te('router-response', 'router:policies-failed', {
      policies: failedPolicies.map(r => ({ type: r.type, error: r.error })),
      allFailed: failedPolicies.length === policyResults.length,
    }));
  }

  // Emit risultato di ogni policy
  for (const r of policyResults) {
    if (!r.failed) {
      emit?.(te('router-response', `policy:result:${r.type}`, {
        type: r.type,
        weight: r.weight,
        routing: r.routing.map(e => ({
          model: e.model,
          point: typeof e.point === 'number' && !isNaN(e.point) ? e.point : 0.5,
          contribution: +((typeof e.point === 'number' && !isNaN(e.point) ? e.point : 0.5) * r.weight).toFixed(4),
        })),
        ...(r.excludes.length > 0 ? { excludes: r.excludes } : {}),
      }));
    }
  }

  // ── Fase 1: raccolta esclusioni hard ──────────────────────────────────────
  const policyExcludes = new Set<string>();
  const excludeReasons = new Map<string, string[]>();
  for (const r of policyResults) {
    for (const id of r.excludes) {
      policyExcludes.add(id);
      if (!excludeReasons.has(id)) excludeReasons.set(id, []);
      excludeReasons.get(id)!.push(r.type);
    }
  }

  if (policyExcludes.size > 0) {
    log?.info(
      { excluded: Object.fromEntries(excludeReasons) },
      'routing: models excluded by policies',
    );
    emit?.(te('router-response', 'router:excludes', {
      excluded: Object.fromEntries(excludeReasons),
    }));
  }

  const scoringCandidates = validCandidates.filter(c => !policyExcludes.has(c.model.id));

  if (scoringCandidates.length === 0) {
    // Message `all_models_excluded_by_policies` is pattern-matched by routing/index.ts's
    // passthrough fallback branch — reword it there too, or the fallback stops firing.
    throw new Error('all_models_excluded_by_policies');
  }

  const scoringIds = new Set(scoringCandidates.map(c => c.model.id));
  const successfulResults = policyResults.filter(r => !r.failed);

  const trace: TraceEntry[] = [
    ...(resilienceTraceEntry ? [resilienceTraceEntry] : []),
    intakeEntry,
    policiesEntry,
    profileEntry,
    ...successfulResults.map(r =>
      te('router-response', `policy:result:${r.type}`, {
        type: r.type,
        weight: r.weight,
        routing: r.routing
          .filter(e => scoringIds.has(e.model))
          .map(e => ({
            model: e.model,
            point: e.point,
            contribution: +(e.point * r.weight).toFixed(4),
          })),
      })
    ),
  ];

  return {
    scoringCandidates,
    rankingAlgorithm,
    successfulResults,
    scoringIds,
    policyExcludes,
    excludeReasons,
    failedPolicies: failedPolicies.map(r => ({ type: r.type, error: r.error })),
    trace,
  };
}

export async function routeRequest(
  request: ChatCompletionRequest,
  router: RouterConfig,
  log?: Logger,
  emit?: (entry: TraceEntry) => void,
  token?: RouterToken,
  traceId?: string,
  conversationId?: string,
  store?: ResilienceStore,
): Promise<RouteResult> {
  const profile = await resolveRoutingProfile(router);
  const picked = pickCallConfig(profile);
  const callDecision = picked ? decideCallTier(request, picked.config, picked.source) : undefined;
  // Adds the call decision and its trace entry to a finished route (bypass and scored alike).
  const withCallConfig = async (result: RouteResult): Promise<RouteResult> => {
    if (!callDecision) return result;
    const all = await listEffectiveModels();
    const entry = te('router-response', 'router:call-config', callConfigTraceDetails(
      callDecision,
      result.models.map(m => ({ id: m.model, model: all.find(x => x.id === m.model) })),
      request,
    ));
    emit?.(entry);
    return { ...result, trace: [...result.trace, entry], callDecision };
  };
  const sc = await scoreCandidates(request, router, profile, log, emit, token, traceId, conversationId, store);
  if (sc.bypass) return withCallConfig(sc.bypass);
  const { scoringCandidates, rankingAlgorithm, successfulResults, scoringIds, policyExcludes, excludeReasons, failedPolicies, trace: preTrace } = sc;

  const { models: finalCandidates, scored, abstained } = RANKING_MAP[rankingAlgorithm]({
    scoringCandidates,
    successfulResults,
    selector: profile.selector,
    selectorCtx: {
      routerId: router.id,
      ...(conversationId !== undefined ? { conversationId } : {}),
    },
  });

  if (abstained.length > 0) {
    log?.info({ abstained }, 'routing: policies abstained (no discriminating signal)');
    emit?.(te('router-response', 'router:abstained', { policies: abstained }));
  }

  const TIED_TOLERANCE = 0.0001;
  const topScore = Math.max(0, ...scored.map(c => c.score));
  const tiedWinners = scored.filter(c => Math.abs(c.score - topScore) < TIED_TOLERANCE);
  const hasTie = tiedWinners.length > 1;

  log?.info(
    {
      policies: successfulResults.map(r => ({
        type: r.type,
        weight: r.weight,
        routing: r.routing
          .filter(e => scoringIds.has(e.model))
          .map(e => ({ model: e.model, point: e.point, contribution: +(e.point * r.weight).toFixed(4) })),
      })),
      rankingAlgorithm,
      final: finalCandidates,
      ...(hasTie ? { tied: tiedWinners.map(c => c.model) } : {}),
      ...(policyExcludes.size > 0 ? { excluded: Object.fromEntries(excludeReasons) } : {}),
    },
    'routing: result',
  );

  // ── Emit recap ────────────────────────────────────────────────────────────
  // recap's final[].score is the 0..1 weighted-mean probability (pre-selector),
  // not the selector's rank-based weight (that's resultEntry's `weight` field).
  const scoredByModel = new Map(scored.map(s => [s.model, s.score]));
  const recapEntry = te('router-response', 'router:recap', {
    rankingAlgorithm,
    rankingSource: profile.id === CUSTOM_PROFILE_ID ? 'router' : 'profile',
    policies: successfulResults.map(r => {
      const scorable = r.routing.filter(e => scoringIds.has(e.model));
      const sorted = [...scorable].sort((a, b) => b.point - a.point);
      const winner = sorted[0];
      return {
        type: r.type,
        weight: +r.weight.toFixed(3),
        winner: winner ? { model: winner.model, point: winner.point } : null,
        scores: sorted.map(s => ({ model: s.model, point: s.point })),
      };
    }),
    final: finalCandidates.map((c, rank) => ({
      rank: rank + 1,
      model: c.model,
      score: scoredByModel.get(c.model) ?? 0,
    })),
    ...(hasTie ? { tie: { count: tiedWinners.length, models: tiedWinners.map(c => c.model) } } : {}),
    ...(policyExcludes.size > 0 ? { excluded: Object.fromEntries(excludeReasons) } : {}),
    ...(failedPolicies.length > 0 ? { failedPolicies } : {}),
  });
  emit?.(recapEntry);

  // ── Emit risultato finale ─────────────────────────────────────────────────
  const resultEntry = te('router-response', 'router:result', {
    final: finalCandidates.map(c => ({
      model: c.model,
      weight: c.weight,
      ...(c.prompt
        ? { prompt: c.prompt.length > 120 ? c.prompt.slice(0, 120) + '…' : c.prompt }
        : {}),
    })),
    ...(hasTie ? { tiedWinners: tiedWinners.map(c => c.model) } : {}),
  });
  emit?.(resultEntry);

  const trace: TraceEntry[] = [...preTrace, recapEntry, resultEntry];

  return withCallConfig({ models: finalCandidates, trace });
}

