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
  weight: number;
}

/**
 * @param candidates Unsorted candidate list; sorted by descending weight before iterating.
 * @param attempt Try one candidate. Return `true` once it has produced a result (success or a
 *   terminal outcome the caller wants to stop on) — the loop stops immediately. Return `false`
 *   to fall back to the next candidate.
 * @param onExhausted Runs once, only when every candidate was tried and none produced a result.
 */
export async function runCandidateLoop<T extends CandidateLoopItem>(
  candidates: T[],
  attempt: (candidate: T) => Promise<boolean>,
  onExhausted: () => void,
): Promise<void> {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
  for (const candidate of sorted) {
    const produced = await attempt(candidate);
    if (produced) return;
  }
  onExhausted();
}
