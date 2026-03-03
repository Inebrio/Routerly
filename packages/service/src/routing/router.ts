import type { ChatCompletionRequest, ModelConfig, ProjectConfig, RoutingCandidate } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import type { CandidateModel } from './policies/types.js';
import { contextPolicy } from './policies/context.js';
import { cheapestPolicy } from './policies/cheapest.js';
import { healthPolicy } from './policies/health.js';
import { llmPolicy } from './policies/llm.js';
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
  llm: llmPolicy,
};

export async function routeRequest(
  request: ChatCompletionRequest,
  project: ProjectConfig,
  log?: Logger,
  emit?: (entry: TraceEntry) => void,
): Promise<RouteResult> {
  const enabledPolicies = (project.policies ?? []).filter(p => p.enabled);

  // Peso normalizzato [0,1]: posizione 0 → 1.0, ultima → 1/N
  const total = enabledPolicies.length;
  const policiesWithWeight = enabledPolicies.map((p, idx) => ({
    position: idx + 1,
    type: p.type,
    weight: total > 1 ? (total - idx) / total : 1,
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

  // ── Emit intake subito ────────────────────────────────────────────────────
  const intakeEntry = te('router-request', 'router:intake', {
    model: request.model,
    messageCount: request.messages?.length ?? 0,
    projectId: project.id,
  });
  emit?.(intakeEntry);

  // ── Emit policy config subito dopo ───────────────────────────────────────
  const policiesEntry = te('router-request', 'router:policies', {
    policies: policiesWithWeight.map(({ type, weight, config }) => ({ type, weight, config })),
    candidates: candidates.map(c => c.model.id),
  });
  emit?.(policiesEntry);

  // ── Esegue le policy in parallelo, emettendo ogni risultato appena pronto ─
  const results = [] as Array<{ weight: number; routing: { model: string; point: number }[] }>;

  await Promise.all(
    policiesWithWeight.map(({ type, weight, config }, i) => {
      const fn = POLICY_MAP[type];
      const p = fn
        ? fn({ request, candidates, config, log, emit, projectId: project.id }).then(out => ({ weight, routing: out.routing }))
        : Promise.resolve({ weight, routing: candidates.map(c => ({ model: c.model.id, point: 1.0 })) });

      return p.then(result => {
        results[i] = result;
        const entry = te('router-response', 'policy:result', {
          type,
          weight,
          routing: result.routing.map(r => ({
            model: r.model,
            point: r.point,
            contribution: +(r.point * weight).toFixed(4),
          })),
        });
        emit?.(entry);
      });
    }),
  );


  // ── Combina i risultati: per ogni modello somma i contributi pesati ────────
  const pointMap = new Map<string, number>();
  for (const { weight: policyWeight, routing } of results) {
    for (const entry of routing) {
      const current = pointMap.get(entry.model) ?? 0;
      pointMap.set(entry.model, current + entry.point * policyWeight);
    }
  }

  const totalWeight = policiesWithWeight.reduce((sum, p) => sum + p.weight, 0);

  const finalCandidates = candidates
    .map(c => ({ model: c.model.id, weight: totalWeight > 0 ? +((pointMap.get(c.model.id) ?? 0) / totalWeight).toFixed(4) : 0 }))
    .sort((a, b) => b.weight - a.weight);

  log?.info(
    {
      policies: policiesWithWeight.map(({ type, weight }, i) => ({
        type,
        weight,
        routing: results[i]?.routing.map(r => ({ model: r.model, point: r.point, contribution: +(r.point * weight).toFixed(4) })),
      })),
      final: finalCandidates,
    },
    'routing: result',
  );

  // ── Emit risultato finale ─────────────────────────────────────────────────
  const resultEntry = te('router-response', 'router:result', {
    final: finalCandidates,
  });
  emit?.(resultEntry);

  const trace: TraceEntry[] = [
    intakeEntry,
    policiesEntry,
    ...policiesWithWeight.map(({ type, weight }, i) =>
      te('router-response', 'policy:result', {
        type,
        weight,
        routing: results[i]?.routing.map(r => ({
          model: r.model,
          point: r.point,
          contribution: +(r.point * weight).toFixed(4),
        })) ?? [],
      })
    ),
    resultEntry,
  ];

  return { models: finalCandidates, trace };
}

