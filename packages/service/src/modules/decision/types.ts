/** A question a decision model answers with one of predefined outcomes. */
export type DecisionQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type DecisionAnswer =
  | { type: 'noul'; probability: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> };

export interface DecisionResult {
  model: string;
  answers: Record<string, DecisionAnswer>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface DecisionOptions {
  timeoutMs?: number;
}

export type SafeDecision =
  | { ok: true; result: DecisionResult }
  | { ok: false; error: string; latencyMs: number; timedOut: boolean };
