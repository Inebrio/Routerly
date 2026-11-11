import type { RoutingCandidate } from '@routerly/shared';
import type { SelectorType } from '@routerly/shared';
import type { ScoredCandidate, SelectorFn } from './types.js';

/*
 * Selectors. A selector receives only the scores computed by the policies and picks among the
 * remaining candidates; it never reads cost, latency, history, counters or other data - whatever
 * must influence the choice is expressed by a policy. Registered selectors: argmax, weighted-random.
 */

const TIED_TOLERANCE = 0.0001;

/** Ranked list -> RoutingCandidate[]. Position is the ranking signal: first = the pick, weight descends by rank. */
function toWeighted(ordered: ScoredCandidate[]): RoutingCandidate[] {
  const n = ordered.length;
  return ordered.map((c, idx) => ({
    model: c.model,
    weight: n - idx,
    ...(c.prompt !== undefined ? { prompt: c.prompt } : {}),
  }));
}

/** Picks one candidate with probability proportional to its score; uniform fallback when all scores are <= 0. */
function pickWeighted(candidates: ScoredCandidate[], rng: () => number): ScoredCandidate {
  const total = candidates.reduce((sum, c) => sum + Math.max(c.score, 0), 0);
  if (total <= 0) {
    const idx = Math.min(Math.floor(rng() * candidates.length), candidates.length - 1);
    return candidates[idx]!;
  }
  let r = rng() * total;
  for (const c of candidates) {
    r -= Math.max(c.score, 0);
    if (r <= 0) return c;
  }
  /* v8 ignore next -- unreachable: r reaches <=0 on the last iteration by construction (sum of subtractions == total) */
  return candidates[candidates.length - 1]!;
}

/**
 * argmax: sort by score desc; ties within TIED_TOLERANCE break by weighted-random among the
 * tied top group. When every policy abstained, no score carries a real preference signal, so
 * the whole candidate pool is treated as tied and picked uniformly at random. This replaces the
 * raw Math.random() path in router.ts's abstain branch while preserving its behavior.
 */
export const argmaxSelector: SelectorFn = (candidates, ctx) => {
  if (candidates.length === 0) return { models: [], trace: [] };
  const rng = ctx.rng ?? Math.random;

  if (ctx.allAbstained) {
    const idx = Math.min(Math.floor(rng() * candidates.length), candidates.length - 1);
    const picked = candidates[idx]!;
    const rest = candidates.filter((_, i) => i !== idx).sort((a, b) => b.score - a.score);
    return { models: toWeighted([picked, ...rest]), trace: [] };
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]!.score;
  const tiedTop = sorted.filter(c => Math.abs(c.score - topScore) < TIED_TOLERANCE);
  if (tiedTop.length <= 1) {
    return { models: toWeighted(sorted), trace: [] };
  }
  const picked = pickWeighted(tiedTop, rng);
  const rest = sorted.filter(c => c !== picked);
  return { models: toWeighted([picked, ...rest]), trace: [] };
};

/** weighted-random: pick one candidate with probability proportional to score; rest ranked by score. */
export const weightedRandomSelector: SelectorFn = (candidates, ctx) => {
  if (candidates.length === 0) return { models: [], trace: [] };
  const rng = ctx.rng ?? Math.random;
  const picked = pickWeighted(candidates, rng);
  const rest = candidates.filter(c => c !== picked).sort((a, b) => b.score - a.score);
  return { models: toWeighted([picked, ...rest]), trace: [] };
};

export const SELECTOR_MAP: Record<SelectorType, SelectorFn> = {
  argmax: argmaxSelector,
  'weighted-random': weightedRandomSelector,
};

export type { ScoredCandidate, SelectorContext, SelectorFn } from './types.js';
