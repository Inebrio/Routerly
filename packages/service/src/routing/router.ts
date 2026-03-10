import type { ChatCompletionRequest, ModelConfig, ProjectConfig, ProjectToken, RoutingCandidate } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { isAllowed } from '../cost/budget.js';
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

type Logger = { info: (obj: object, msg?: string) => void };

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

  // Decay lineare leggero: la prima policy vale 1.5×l'ultima.
  // Con spread fissa a 0.5/(N-1) per step, il rapporto max:min è sempre
  // 1.5:1 indipendentemente dal numero di policy abilitate — abbastanza
  // da dare priorità all'ordinamento dell'utente, senza azzerare le policy
  // in coda (il vecchio approccio dava ratio 9:1 con 9 policy).
  const total = enabledPolicies.length;
  const policiesWithWeight = enabledPolicies.map((p, idx) => ({
    position: idx + 1,
    type: p.type,
    weight: total > 1 ? 1 + ((total - 1 - idx) / (total - 1)) * 0.5 : 1,
    config: p.config,
  }));

  // Carica i ModelConfig completi per i modelli associati al progetto
  const allModels: ModelConfig[] = await readConfig('models');
  const candidates: CandidateModel[] = project.models
    .map(ref => {
      const model = allModels.find(m => m.id === ref.modelId);
      return model ? { model, prompt: ref.prompt, thresholds: ref.thresholds } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // ── Pre-filtro limiti ────────────────────────────────────────────────────
  // Esclude i modelli che hanno già superato uno o più limiti prima di
  // coinvolgere qualunque policy, così alle policy arrivano solo candidati
  // ancora validi.
  const excludedByLimits: string[] = [];
  const validCandidates: CandidateModel[] = [];

  await Promise.all(
    candidates.map(async (c) => {
      const allowed = await isAllowed(c.model, project, token);
      if (!allowed) {
        excludedByLimits.push(c.model.id);
      } else {
        validCandidates.push(c);
      }
    }),
  );

  if (excludedByLimits.length > 0) {
    log?.info({ excluded: excludedByLimits }, 'routing: models excluded — limits already exceeded');
  }

  if (validCandidates.length === 0) {
    throw new Error('all_models_limits_exceeded');
  }

  // ── Emit intake subito ────────────────────────────────────────────────────
  const intakeEntry = te('router-request', 'router:intake', {
    model: request.model,
    messageCount: request.messages?.length ?? 0,
    projectId: project.id,
  });
  emit?.(intakeEntry);

  // ── Bypass diretto se rimane un solo candidato valido ────────────────────
  if (validCandidates.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
    return { models: [singleResult], trace: [intakeEntry, bypassEntry] };
  }

  // ── Emit policy config subito dopo ───────────────────────────────────────
  const policiesEntry = te('router-request', 'router:policies', {
    policies: policiesWithWeight.map(({ type, weight, config }) => ({ type, weight, config })),
    candidates: validCandidates.map(c => c.model.id),
  });
  emit?.(policiesEntry);

  // ── Esegue le policy in parallelo, emettendo ogni risultato appena pronto ─
  const results = [] as Array<{ weight: number; routing: { model: string; point: number }[] }>;

  await Promise.all(
    policiesWithWeight.map(({ type, weight, config }, i) => {
      const fn = POLICY_MAP[type];
      const p = fn
        ? fn({ request, candidates: validCandidates, config, log, emit, projectId: project.id, token, traceId })
            .then(out => ({ weight, routing: out.routing }))
            .catch(err => {
              const errMsg = err instanceof Error ? err.message : String(err);
              log?.error({ type, err: errMsg }, 'routing: policy failed');
              emit?.(te('router-response', `policy:error:${type}`, { type, error: errMsg }));
              // Fallback: tutti i modelli con score neutro
              return { weight, routing: validCandidates.map(c => ({ model: c.model.id, point: 1.0 })) };
            })
        : Promise.resolve({ weight, routing: validCandidates.map(c => ({ model: c.model.id, point: 1.0 })) });

      return p.then(result => {
        results[i] = result;
        const entry = te('router-response', `policy:result:${type}`, {
          type,
          weight,
          routing: result.routing.map(r => ({
            model: r.model,
            point: typeof r.point === 'number' && !isNaN(r.point) ? r.point : 1.0,
            contribution: +((typeof r.point === 'number' && !isNaN(r.point) ? r.point : 1.0) * weight).toFixed(4),
          })),
        });
        emit?.(entry);
      });
    }),
  );


  // ── Combina i risultati: media pesata normalizzata ───────────────────────
  //
  // Strategia:
  // 1. Normalizza gli score di ogni policy tra 0 e 1 (min-max normalization)
  // 2. Solo i voti espliciti contribuiscono (no fill neutro)
  // 3. Ogni modello riceve la media pesata solo delle policy che lo hanno votato
  // 4. Bonus posizionale controllato per mantenere score finale ≤ 1
  // 5. Identificazione esplicita dei pari merito

  const allCandidateIds = validCandidates.map(c => c.model.id);

  // Normalizza ogni policy: trasforma i suoi punteggi in range 0-1
  const normalizedResults = results.map(({ weight: policyWeight, routing }) => {
    if (routing.length === 0) return { weight: policyWeight, routing: [] };

    const vals = routing.map(r => r.point);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;

    // Se tutti i punteggi sono uguali, assegna 0.5 a tutti
    const normalized = range > 0.0001
      ? routing.map(r => ({ model: r.model, point: (r.point - min) / range }))
      : routing.map(r => ({ model: r.model, point: 0.5 }));

    return { weight: policyWeight, routing: normalized };
  });

  // Accumula score pesati + tieni traccia dei pesi effettivi per modello
  const scoreAccumulator = new Map<string, number>();
  const weightAccumulator = new Map<string, number>();
  allCandidateIds.forEach(id => {
    scoreAccumulator.set(id, 0);
    weightAccumulator.set(id, 0);
  });

  for (const { weight: policyWeight, routing } of normalizedResults) {
    for (const r of routing) {
      scoreAccumulator.set(r.model, (scoreAccumulator.get(r.model) ?? 0) + r.point * policyWeight);
      weightAccumulator.set(r.model, (weightAccumulator.get(r.model) ?? 0) + policyWeight);
    }
  }

  // Calcola media pesata: dividi per la somma dei pesi delle policy che hanno votato
  const baseScores = new Map<string, number>();
  allCandidateIds.forEach(id => {
    const totalScore = scoreAccumulator.get(id) ?? 0;
    const totalWeight = weightAccumulator.get(id) ?? 0;
    baseScores.set(id, totalWeight > 0 ? totalScore / totalWeight : 0);
  });

  // Bonus posizionale: riflette la rilevanza dell'ordine configurato
  // Il primo modello è il più rilevante, l'ultimo il meno rilevante
  // Scala per non superare mai 1.0
  const maxBase = Math.max(...Array.from(baseScores.values()));
  const POSITION_BONUS_MAX = Math.min(0.10, 1.0 - maxBase); // Max 10% o quello che serve per restare sotto 1
  const N = validCandidates.length;

  const finalCandidates: RoutingCandidate[] = validCandidates
    .map((c, idx) => {
      const baseScore = baseScores.get(c.model.id) ?? 0;
      const posBonus = N > 1 ? (POSITION_BONUS_MAX * (N - 1 - idx)) / (N - 1) : 0;
      return {
        model: c.model.id,
        weight: Math.min(1.0, +(baseScore + posBonus).toFixed(4)),
        ...(c.prompt ? { prompt: c.prompt } : {}),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  // Identifica pari merito: modelli con lo stesso score entro tolleranza di 0.0001
  const TIED_TOLERANCE = 0.0001;
  const topScore = finalCandidates[0]?.weight ?? 0;
  const tiedWinners = finalCandidates.filter(c => Math.abs(c.weight - topScore) < TIED_TOLERANCE);
  const hasTie = tiedWinners.length > 1;

  log?.info(
    {
      promptsConfigured: validCandidates.filter(c => c.prompt).map(c => c.model.id),
      policies: policiesWithWeight.map(({ type, weight }, i) => ({
        type,
        weight,
        routing: normalizedResults[i]?.routing.map(r => ({ model: r.model, point: r.point, contribution: +(r.point * weight).toFixed(4) })),
      })),
      final: finalCandidates,
      ...(hasTie ? { tied: tiedWinners.map(c => c.model) } : {}),
    },
    'routing: result',
  );

  // ── Emit recap: vincitore per policy + classifica finale ─────────────────
  const recapEntry = te('router-response', 'router:recap', {
    policies: policiesWithWeight.map(({ type, weight }, i) => {
      const routing = normalizedResults[i]?.routing ?? [];
      const sorted = [...routing].sort((a, b) => b.point - a.point);
      const winner = sorted[0];
      return {
        type,
        weight: +weight.toFixed(3),
        winner: winner ? {
          model: winner.model,
          point: typeof winner.point === 'number' && !isNaN(winner.point) ? winner.point : 1.0
        } : null,
        scores: sorted.map(r => ({
          model: r.model,
          point: typeof r.point === 'number' && !isNaN(r.point) ? r.point : 1.0
        })),
      };
    }),
    final: finalCandidates.map((c, rank) => ({
      rank: rank + 1,
      model: c.model,
      score: typeof c.weight === 'number' && !isNaN(c.weight) ? c.weight : 1.0
    })),
    ...(hasTie ? { tie: { count: tiedWinners.length, models: tiedWinners.map(c => c.model) } } : {}),
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
    ...policiesWithWeight.map(({ type, weight }, i) =>
      te('router-response', `policy:result:${type}`, {
        type,
        weight,
        routing: results[i]?.routing.map(r => ({
          model: r.model,
          point: r.point,
          contribution: +(r.point * weight).toFixed(4),
        })) ?? [],
      })
    ),
    recapEntry,
    resultEntry,
  ];

  return { models: finalCandidates, trace };
}

