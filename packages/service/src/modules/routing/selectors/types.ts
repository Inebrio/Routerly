import type { RouteResult } from '../router.js';

/** A candidate model already scored by the policy phase (weighted-mean 0..1, NaN-safe). */
export interface ScoredCandidate {
  model: string;
  score: number;
  cost?: number;
  prompt?: string;
}

/** Context passed to a selector alongside the scored candidates. */
export interface SelectorContext {
  projectId: string;
  conversationId?: string;
  /** True when every active policy abstained (no discriminating signal). */
  allAbstained: boolean;
  /** Resilience seam: filter out unavailable models, when the caller supplies it. */
  isAvailable?: (modelId: string) => boolean;
  /** Lowest-latency seam: returns known latency for a model, if any. */
  latencyOf?: (modelId: string) => number | undefined;
  // ponytail: rng injectable only for test determinism
  rng?: () => number;
}

export type SelectorFn = (candidates: ScoredCandidate[], ctx: SelectorContext) => RouteResult;
