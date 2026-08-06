import type { ScoredCandidate } from '../selectors/types.js';

export type FallbackAction =
  | { kind: 'try'; model: string }
  | { kind: 'cooldown'; model: string; ms: number }
  | { kind: 'abort' };

export interface FallbackContext {
  failed: string; // model id that just errored
  remaining: ScoredCandidate[]; // ranked, failed model already removed
  error: unknown;
  isAvailable?: (modelId: string) => boolean;
}

export type FallbackStrategyFn = (ctx: FallbackContext) => FallbackAction;

export type { ScoredCandidate } from '../selectors/types.js';
