import type { RouteResult } from '../router.js';

/** A candidate model already scored by the policy phase (weighted-mean 0..1, NaN-safe). */
export interface ScoredCandidate {
  model: string;
  score: number;
  prompt?: string;
}

/** Context passed to a selector alongside the scored candidates. */
export interface SelectorContext {
  routerId: string;
  conversationId?: string;
  /** True when every active policy abstained (no discriminating signal). */
  allAbstained: boolean;
  // ponytail: rng injectable only for test determinism
  rng?: () => number;
}

export type SelectorFn = (candidates: ScoredCandidate[], ctx: SelectorContext) => RouteResult;
