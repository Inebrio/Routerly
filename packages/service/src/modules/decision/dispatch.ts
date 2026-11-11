import type { ModelConfig } from '@routerly/shared';
import { typesafeDecide } from './typesafe.js';
import type { DecisionOptions, DecisionQuestion, DecisionResult, SafeDecision } from './types.js';

export type { DecisionQuestion, DecisionAnswer, DecisionResult, DecisionOptions, SafeDecision } from './types.js';

type Decide = (model: ModelConfig, state: string, questions: Record<string, DecisionQuestion>, opts?: DecisionOptions) => Promise<DecisionResult>;

const VENDORS: Record<string, Decide> = { typesafe: typesafeDecide };

/** Ask a decision model. Throws on any failure; features must use decideSafe. */
export function decide(model: ModelConfig, state: string, questions: Record<string, DecisionQuestion>, opts?: DecisionOptions): Promise<DecisionResult> {
  const vendor = VENDORS[model.provider];
  if (!vendor) return Promise.reject(new Error(`Provider "${model.provider}" is not a decision provider`));
  return vendor(model, state, questions, opts);
}

/** Never throws: a decision-model problem must never fail the client request. */
export async function decideSafe(model: ModelConfig, state: string, questions: Record<string, DecisionQuestion>, opts?: DecisionOptions): Promise<SafeDecision> {
  const t0 = Date.now();
  try {
    return { ok: true, result: await decide(model, state, questions, opts) };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0, timedOut };
  }
}
