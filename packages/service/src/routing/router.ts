import type { ChatCompletionRequest, ModelConfig, ProjectConfig, RoutingCandidate } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import type { CandidateModel } from './policies/types.js';
import { contextPolicy } from './policies/context.js';
import { cheapestPolicy } from './policies/cheapest.js';
import { healthPolicy } from './policies/health.js';
import { llmPolicy } from './policies/llm.js';
import type { PolicyFn } from './policies/types.js';
import type { TraceEntry } from './traceStore.js';

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

  // Esegue tutte le policy in parallelo — il tempo totale è quello della policy più lenta
  const results = await Promise.all(
    policiesWithWeight.map(({ type, weight, config }) => {
      const fn = POLICY_MAP[type];
      if (!fn) return Promise.resolve({ weight, routing: candidates.map(c => ({ model: c.model.id, point: 1.0 })) });
      return fn({ request, candidates, config, log }).then(out => ({ weight, routing: out.routing }));
    })
  );

  // Combina i risultati: per ogni modello somma i contributi pesati (point * policyWeight) di ogni policy
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

  const traceRequest: TraceEntry = {
    policy: 'router',
    message: 'router:request',
    details: {
      policies: policiesWithWeight.map(({ type, weight, config }) => ({ type, weight, config })),
      candidates: candidates.map(c => c.model.id),
    },
  };

  const traceResult: TraceEntry = {
    policy: 'router',
    message: 'router:result',
    details: {
      policies: policiesWithWeight.map(({ type, weight }, i) => ({
        type,
        weight,
        routing: results[i]?.routing.map(r => ({
          model: r.model,
          point: r.point,
          contribution: +(r.point * weight).toFixed(4),
        })),
      })),
      final: finalCandidates,
    },
  };

  return { models: finalCandidates, trace: [traceRequest, traceResult] };
}

