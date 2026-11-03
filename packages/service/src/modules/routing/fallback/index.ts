import type { FallbackStrategyType } from '@routerly/shared';
import type { FallbackAction, FallbackContext, FallbackStrategyFn } from './types.js';

const COOLDOWN_MS = 2000;

/** next-best: try the highest-ranked remaining candidate that passes isAvailable (or any, if no seam); abort if none. */
export const nextBestStrategy: FallbackStrategyFn = (ctx: FallbackContext): FallbackAction => {
  const pick = ctx.isAvailable
    ? ctx.remaining.find(c => ctx.isAvailable!(c.model))
    : ctx.remaining[0];
  return pick ? { kind: 'try', model: pick.model } : { kind: 'abort' };
};

// ponytail: single retry then next-best; no exponential backoff until measured need
/**
 * retry-after-cooldown: always returns a cooldown action for the failed model. No internal or
 * module-level state: the "then next-best on the following call" behavior belongs to the caller
 * (the future retry loop), which is expected to track whether a model already had its cooldown
 * and invoke nextBestStrategy instead on the next failure. This function stays pure.
 */
export const retryAfterCooldownStrategy: FallbackStrategyFn = (ctx: FallbackContext): FallbackAction => {
  return { kind: 'cooldown', model: ctx.failed, ms: COOLDOWN_MS };
};

/** abort: always aborts, regardless of context. */
export const abortStrategy: FallbackStrategyFn = (): FallbackAction => {
  return { kind: 'abort' };
};

export const FALLBACK_MAP: Record<FallbackStrategyType, FallbackStrategyFn> = {
  'next-best': nextBestStrategy,
  'retry-after-cooldown': retryAfterCooldownStrategy,
  abort: abortStrategy,
};

export type { FallbackAction, FallbackContext, FallbackStrategyFn } from './types.js';
export type { ScoredCandidate } from '../selectors/types.js';
