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
export interface CandidateLoopItem {
  // Optional: the Orchestrator's candidate loop (`orchestrate.ts`) always passes
  // `presorted: true` and its items (`OrchestratorCandidateRef`) carry no `weight` —
  // priority is array order there, not a stored number. Only the plain-Router model
  // loop's unsorted path reads this field.
  weight?: number;
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
  attempt: (candidate: T) => Promise<boolean>,
  onExhausted: () => void,
  options?: RunCandidateLoopOptions,
): Promise<void> {
  const weightOf = (item: T) => (item as CandidateLoopItem).weight ?? 0;
  const ordered = options?.presorted ? candidates : [...candidates].sort((a, b) => weightOf(b) - weightOf(a));
  for (const candidate of ordered) {
    const produced = await attempt(candidate);
    if (produced) return;
  }
  onExhausted();
}
