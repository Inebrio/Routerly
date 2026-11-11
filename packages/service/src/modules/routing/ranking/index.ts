import { DEFAULT_RANKING_ALGORITHM, RANKING_ALGORITHMS, type RankingAlgorithmId, type RoutingCandidate, type SelectorType } from '@routerly/shared';
import type { CandidateModel } from '../policies/types.js';
import { SELECTOR_MAP, argmaxSelector } from '../selectors/index.js';
import type { ScoredCandidate, SelectorContext } from '../selectors/index.js';

export interface RankingInput {
  scoringCandidates: CandidateModel[];
  successfulResults: { type: string; weight: number; routing: { model: string; point: number }[] }[];
  selector: SelectorType;
  selectorCtx: Omit<SelectorContext, 'allAbstained'>;
}

export interface RankingOutput {
  /** Full candidate order, best first. */
  models: RoutingCandidate[];
  scored: ScoredCandidate[];
  abstained: string[];
  allAbstained: boolean;
}

export type RankingFn = (input: RankingInput) => RankingOutput;

/**
 * Current behaviour: weighted mean of the raw policy points (Phase 2), then the profile's selector.
 */
const defaultRanking: RankingFn = ({ scoringCandidates, successfulResults, selector, selectorCtx }) => {
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

  // When every active policy abstained (or none were configured), no policy has a
  // preference. Use random weights so the router distributes traffic uniformly over
  // time instead of always picking the first model in the router config.
  const allPoliciesAbstained = abstainedPolicies.length === successfulResults.length;

  const scored: ScoredCandidate[] = scoringCandidates.map(c => {
    const totalScore = scoreAccumulator.get(c.model.id) ?? 0;
    const totalWeight = weightAccumulator.get(c.model.id) ?? 0;
    const score = totalWeight > 0 ? totalScore / totalWeight : 0.5;
    return {
      model: c.model.id,
      score: +score.toFixed(4),
      ...(c.prompt ? { prompt: c.prompt } : {}),
    };
  });

  // A stale selector (profile not yet migrated, restored config) falls back to argmax instead of failing the request.
  const models = (SELECTOR_MAP[selector] ?? argmaxSelector)(scored, { ...selectorCtx, allAbstained: allPoliciesAbstained }).models;
  return { models, scored, abstained: abstainedPolicies, allAbstained: allPoliciesAbstained };
};

/** Typed Record: adding an id to RANKING_ALGORITHMS fails to compile until it is implemented here. */
export const RANKING_MAP: Record<RankingAlgorithmId, RankingFn> = {
  default: defaultRanking,
};

/**
 * Absent id -> default. Unknown id (config written by a newer build) -> default plus a warning:
 * a downgrade keeps serving instead of failing the request. Writes are validated strictly elsewhere.
 */
export function resolveRankingAlgorithm(
  id: string | undefined,
  log?: { warn: (obj: object, msg?: string) => void },
): RankingAlgorithmId {
  if (id === undefined) return DEFAULT_RANKING_ALGORITHM;
  if ((RANKING_ALGORITHMS as readonly string[]).includes(id)) return id as RankingAlgorithmId;
  log?.warn({ rankingAlgorithm: id }, 'routing: unknown ranking algorithm, falling back to default');
  return DEFAULT_RANKING_ALGORITHM;
}
