import type { ChatCompletionRequest, ModelConfig, ProjectConfig, ProjectToken, RoutingCandidate } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { isAllowed, getViolatedLimits } from '../cost/budget.js';
import type { LimitSnapshot } from '../cost/budget.js';
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
import type { PolicyFn } from './policies/types.js';
import type { TraceEntry, TracePanel } from './traceStore.js';

function te(panel: TracePanel, message: string, details: Record<string, unknown>): TraceEntry {
  return { panel, message, details };
}

export interface RouteResult {
  models: RoutingCandidate[];
  trace: TraceEntry[];
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
};

export async function routeRequest(
  request: ChatCompletionRequest,
  project: ProjectConfig,
  log?: Logger,
  emit?: (entry: TraceEntry) => void,
  token?: ProjectToken,
  traceId?: string,
): Promise<RouteResult> {
  const enabledPolicies = (project.policies ?? []).filter(p => p.enabled);

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
  const allModels: ModelConfig[] = await readConfig('models');
  const candidates: CandidateModel[] = project.models
    .map(ref => {
      const model = allModels.find(m => m.id === ref.modelId);
      return model ? { model, ...(ref.prompt !== undefined ? { prompt: ref.prompt } : {}), ...(ref.thresholds !== undefined ? { thresholds: ref.thresholds } : {}) } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // ── Pre-filtro limiti ────────────────────────────────────────────────────
  // Esclude i modelli che hanno già superato uno o più limiti prima di
  // coinvolgere qualunque policy, così alle policy arrivano solo candidati
  // ancora validi.
  type LimitExclusion = { modelId: string; violated: LimitSnapshot[] };
  const excludedByLimits: LimitExclusion[] = [];
  const validCandidates: CandidateModel[] = [];

  await Promise.all(
    candidates.map(async (c) => {
      const allowed = await isAllowed(c.model, project, token);
      if (!allowed) {
        const violated = await getViolatedLimits(c.model, project, token);
        excludedByLimits.push({ modelId: c.model.id, violated });
      } else {
        validCandidates.push(c);
      }
    }),
  );

  if (excludedByLimits.length > 0) {
    for (const exc of excludedByLimits) {
      log?.debug(
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
    throw new Error('all_models_limits_exceeded');
  }

  // ── Emit intake subito ────────────────────────────────────────────────────
  const intakeEntry = te('router-request', 'router:intake', {
    model: request.model,
    messageCount: request.messages?.length ?? 0,
    projectId: project.id,
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const only = validCandidates[0]!;
    log?.debug(
      { modelId: only.model.id, totalCandidates: candidates.length },
      'routing: single valid model — bypassing policies, forwarding directly',
    );
    const singleResult: RoutingCandidate = { model: only.model.id, weight: 1, ...(only.prompt ? { prompt: only.prompt } : {}) };
    const bypassEntry = te('router-response', 'router:result', {
      final: [{ model: singleResult.model, weight: singleResult.weight, hasPrompt: !!singleResult.prompt }],
      note: 'single_candidate_bypass',
    });
    emit?.(bypassEntry);
    return { models: [singleResult], trace: [intakeEntry, bypassEntry] };
  }

  // ── Emit policy config subito dopo ───────────────────────────────────────
  const policiesEntry = te('router-request', 'router:policies', {
    policies: policiesWithWeight.map(({ type, weight, config }) => ({ type, weight, config })),
    candidates: validCandidates.map(c => c.model.id),
  });
  emit?.(policiesEntry);

  // ── Esegue le policy in parallelo ─────────────────────────────────────────
  const policyResults = await Promise.all(
    policiesWithWeight.map(async ({ type, weight, config }) => {
      const fn = POLICY_MAP[type];
      if (!fn) {
        log?.debug({ type }, 'routing: unknown policy type, skipping');
        return { type, weight, routing: [] as { model: string; point: number }[], excludes: [] as string[], failed: true };
      }
      try {
        const out = await fn({ request, candidates: validCandidates, config, ...(log !== undefined ? { log } : {}), ...(emit !== undefined ? { emit } : {}), projectId: project.id, ...(token !== undefined ? { token } : {}), ...(traceId !== undefined ? { traceId } : {}) });
        return { type, weight, routing: out.routing, excludes: out.excludes ?? [], failed: false };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.debug({ type, err: errMsg }, 'routing: policy failed');
        emit?.(te('router-response', `policy:error:${type}`, { type, error: errMsg }));
        return { type, weight, routing: [] as { model: string; point: number }[], excludes: [] as string[], failed: true };
      }
    }),
  );

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
    log?.debug(
      { excluded: Object.fromEntries(excludeReasons) },
      'routing: models excluded by policies',
    );
    emit?.(te('router-response', 'router:excludes', {
      excluded: Object.fromEntries(excludeReasons),
    }));
  }

  const scoringCandidates = validCandidates.filter(c => !policyExcludes.has(c.model.id));

  if (scoringCandidates.length === 0) {
    throw new Error('all_models_excluded_by_policies');
  }

  // ── Fase 2: media pesata dei punteggi raw (senza normalizzazione) ─────────
  //
  // Le policy restituiscono già punteggi 0–1 con semantica propria.
  // Una policy in cui tutti i candidati hanno lo stesso punteggio non ha
  // potere discriminante: viene ignorata (astensione). Se conteggiata,
  // diluirebbe le policy che differenziano senza aggiungere informazione.
  const scoringIds = new Set(scoringCandidates.map(c => c.model.id));
  const scoreAccumulator = new Map<string, number>();
  const weightAccumulator = new Map<string, number>();
  for (const c of scoringCandidates) {
    scoreAccumulator.set(c.model.id, 0);
    weightAccumulator.set(c.model.id, 0);
  }

  const successfulResults = policyResults.filter(r => !r.failed);
  const abstainedPolicies: string[] = [];

  for (const { type, weight: policyWeight, routing } of successfulResults) {
    const eligible = routing.filter(r => scoringIds.has(r.model));

    // Astensione: se tutti i validi hanno lo stesso punteggio (±0.0001),
    // la policy non contribuisce alla media pesata.
    const points = eligible.map(r => (typeof r.point === 'number' && !isNaN(r.point) ? r.point : 0.5));
    const min = Math.min(...points);
    const max = Math.max(...points);
    if (eligible.length === 0 || max - min < 0.0001) {
      abstainedPolicies.push(type);
      continue;
    }

    for (const r of eligible) {
      const point = typeof r.point === 'number' && !isNaN(r.point) ? r.point : 0.5;
      scoreAccumulator.set(r.model, (scoreAccumulator.get(r.model) ?? 0) + point * policyWeight);
      weightAccumulator.set(r.model, (weightAccumulator.get(r.model) ?? 0) + policyWeight);
    }
  }

  if (abstainedPolicies.length > 0) {
    log?.debug({ abstained: abstainedPolicies }, 'routing: policies abstained (no discriminating signal)');
    emit?.(te('router-response', 'router:abstained', { policies: abstainedPolicies }));
  }

  const finalCandidates: RoutingCandidate[] = scoringCandidates
    .map(c => {
      const totalScore = scoreAccumulator.get(c.model.id) ?? 0;
      const totalWeight = weightAccumulator.get(c.model.id) ?? 0;
      const score = totalWeight > 0 ? totalScore / totalWeight : 0.5;
      return {
        model: c.model.id,
        weight: +score.toFixed(4),
        ...(c.prompt ? { prompt: c.prompt } : {}),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  const TIED_TOLERANCE = 0.0001;
  const topScore = finalCandidates[0]?.weight ?? 0;
  const tiedWinners = finalCandidates.filter(c => Math.abs(c.weight - topScore) < TIED_TOLERANCE);
  const hasTie = tiedWinners.length > 1;

  log?.debug(
    {
      policies: successfulResults.map(r => ({
        type: r.type,
        weight: r.weight,
        routing: r.routing
          .filter(e => scoringIds.has(e.model))
          .map(e => ({ model: e.model, point: e.point, contribution: +(e.point * r.weight).toFixed(4) })),
      })),
      final: finalCandidates,
      ...(hasTie ? { tied: tiedWinners.map(c => c.model) } : {}),
      ...(policyExcludes.size > 0 ? { excluded: Object.fromEntries(excludeReasons) } : {}),
    },
    'routing: result',
  );

  // ── Emit recap ────────────────────────────────────────────────────────────
  const recapEntry = te('router-response', 'router:recap', {
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
      score: c.weight,
    })),
    ...(hasTie ? { tie: { count: tiedWinners.length, models: tiedWinners.map(c => c.model) } } : {}),
    ...(policyExcludes.size > 0 ? { excluded: Object.fromEntries(excludeReasons) } : {}),
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

  const trace: TraceEntry[] = [
    intakeEntry,
    policiesEntry,
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
    recapEntry,
    resultEntry,
  ];

  return { models: finalCandidates, trace };
}

