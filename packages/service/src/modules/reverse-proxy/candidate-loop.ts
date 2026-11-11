/**
 * Shared per-candidate try/fallback loop (RTR-02 task 3). Extracted, behavior-preserving,
 * from the loop previously inlined in `lanes/anthropic.ts`'s `anthropicAttempt` and
 * `lanes/openai.ts`'s `openaiAttempt`: sort candidates highest-weight first, try each in
 * order, stop on the first one that produces a result, run `onExhausted` once if none did.
 *
 * The loop itself carries no usage-tracking or event-emission logic — that stays in each
 * caller's `attempt`/`onExhausted` closures, since it differs per lane (the OpenAI lane emits
 * `routing.fallback_used`/`routing.no_candidates`, the Anthropic lane emits neither — decision
 * #8) and per use (the plain-Router model loop vs. `forwardToRouter`'s candidate-Router loop,
 * task 3).
 */
import { resilienceKeys } from '../resilience/keys.js';
import { getResilienceStore } from '../resilience/index.js';
import { UPSTREAM_PASSTHROUGH_STATUS } from '../../lib/protocol-errors.js';
import { COOLDOWN_MS } from '../routing/fallback/index.js';
import type { FallbackStrategyType } from '@routerly/shared';
import type { ProxyContext } from './context.js';

export interface CandidateLoopItem {
  // Optional: the Orchestrator's candidate loop (`orchestrate.ts`) always passes
  // `presorted: true` and its items (`OrchestratorCandidateRef`) carry no `weight` —
  // priority is array order there, not a stored number. Only the plain-Router model
  // loop's unsorted path reads this field.
  weight?: number;
}

/** Retries of the same model a `retry-after-cooldown` profile may spend on ONE request, across all candidates. */
export const MAX_COOLDOWN_RETRIES = 2;

/**
 * What one attempt reports. `true`: produced a result, stop. `false`: failed, no detail (same as
 * `{ reason: 'error', retryable: true }`). `'skip'`: a local skip (budget, unknown model), not an
 * upstream failure, so no strategy applies. Object: failed, with the reason traced and whether
 * the same model is worth retrying (a deterministic 4xx is not).
 */
export type AttemptOutcome = boolean | 'skip' | { reason: string; retryable: boolean };

export interface FallbackEvent<T> {
  strategy: FallbackStrategyType;
  action: 'retry' | 'next' | 'abort' | 'exhausted';
  candidate: T;
  reason: string;
  retry?: number;
  waitMs?: number;
}

export interface RunCandidateLoopOptions {
  /**
   * The Orchestrator's candidate loop (`orchestrate.ts`'s `forwardToRouter`) passes candidates
   * already ranked by `scoreOrchestratorCandidates` (health/rate-limit/fairness blend, `weight`
   * only a 0.0001 tiebreak) — re-sorting them here by raw `weight` would discard that ranking
   * and route every request to the highest-weight candidate regardless of quality. Set `true` to
   * try `candidates` in the order given, unsorted. Defaults to `false` (sort by weight
   * descending), which is the correct behavior for the plain-Router model loop this was
   * originally written for.
   */
  presorted?: boolean;
  /** Profile fallback strategy; defaults to `next-best` (walk to the next candidate). */
  strategy?: FallbackStrategyType;
  /** Health gate for `retry-after-cooldown`, evaluated after the wait: false = go to the next candidate instead. */
  canRetry?: (candidate: unknown) => boolean;
  /** Called on every failed attempt with what the strategy decided (traced by the lanes). */
  onFallback?: (event: FallbackEvent<unknown>) => void;
}

/**
 * @param candidates Candidate list. Sorted by descending weight before iterating, unless
 *   `options.presorted` is set, in which case it is tried in the order given.
 * @param attempt Try one candidate. Return `true` once it has produced a result (success or a
 *   terminal outcome the caller wants to stop on) — the loop stops immediately. Return `false`
 *   to fall back to the next candidate.
 * @param onExhausted Runs once, only when every candidate was tried and none produced a result.
 */
export async function runCandidateLoop<T>(
  candidates: T[],
  attempt: (candidate: T) => Promise<AttemptOutcome>,
  onExhausted: () => void,
  options?: RunCandidateLoopOptions,
): Promise<void> {
  const weightOf = (item: T) => (item as CandidateLoopItem).weight ?? 0;
  const ordered = options?.presorted ? candidates : [...candidates].sort((a, b) => weightOf(b) - weightOf(a));
  const strategy = options?.strategy ?? 'next-best';
  let retries = 0;
  for (const [index, candidate] of ordered.entries()) {
    for (;;) {
      const outcome = await attempt(candidate);
      if (outcome === true) return;
      if (outcome === 'skip') break;
      const failure = typeof outcome === 'object' ? outcome : { reason: 'error', retryable: true };
      const event = (action: FallbackEvent<T>['action'], extra: Partial<FallbackEvent<T>> = {}) =>
        options?.onFallback?.({ strategy, action, candidate, reason: failure.reason, ...extra });
      if (strategy === 'abort') {
        event('abort');
        onExhausted();
        return;
      }
      if (strategy === 'retry-after-cooldown' && failure.retryable && retries < MAX_COOLDOWN_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
        if (options?.canRetry?.(candidate) ?? true) {
          retries++;
          event('retry', { retry: retries, waitMs: COOLDOWN_MS });
          continue;
        }
      }
      event(index < ordered.length - 1 ? 'next' : 'exhausted');
      break;
    }
  }
  onExhausted();
}

/**
 * Reads and clears the failure the last attempt stashed on the context. `'skip'` when nothing was
 * stashed (a local budget skip). The reason is a status or an error NAME, never a message: provider
 * errors can echo request details, and the reason goes into the usage trace.
 */
export function takeAttemptFailure(ctx: ProxyContext): AttemptOutcome {
  if (ctx.attemptError === undefined) return 'skip';
  const status = ctx.attemptResponse?.status;
  const reason = status !== undefined ? `HTTP ${status}` : ctx.attemptError instanceof Error ? ctx.attemptError.name : 'error';
  ctx.attemptError = undefined;
  delete ctx.attemptResponse;
  return { reason, retryable: status === undefined || !UPSTREAM_PASSTHROUGH_STATUS.includes(status) };
}

/** Loop options of a plain-Router lane: the profile strategy, the health gate and the `router:fallback` trace. */
export function laneFallbackOptions(ctx: ProxyContext): RunCandidateLoopOptions {
  return {
    ...(ctx.fallbackStrategy ? { strategy: ctx.fallbackStrategy } : {}),
    canRetry: () => {
      const store = getResilienceStore();
      const model = ctx.attempt?.model;
      if (!store || !model) return true;
      return Object.values(resilienceKeys(model)).every((key) => store.isAvailable(key));
    },
    onFallback: (e) => {
      const modelId = ctx.attempt?.model.id;
      ctx.log.info({ modelId, ...e, candidate: undefined }, 'routing: fallback decision');
      ctx.emit?.({
        panel: 'router-response',
        message: 'router:fallback',
        details: { strategy: e.strategy, action: e.action, model: modelId, reason: e.reason, ...(e.retry !== undefined ? { retry: e.retry, waitMs: e.waitMs } : {}) },
      });
    },
  };
}
