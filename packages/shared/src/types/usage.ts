/**
 * Request types for usage records (T60).
 *
 * `callType` says who made the call (the client, the router, a guardrail).
 * `requestType` says what was asked for, derived from the path the client hit,
 * so a usage record can be read without opening its trace.
 */

import type { OptimizerId } from './optimizers.js';

export const REQUEST_TYPES = ['chat', 'completion', 'embedding', 'rerank', 'image', 'audio'] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

/**
 * The request type a path stands for, or `undefined` when the path is not a
 * model API call. Order matters: `/chat/completions` is chat, plain
 * `/completions` is the legacy text-completion API.
 *
 * Matching is on the path suffix rather than the full route because the same
 * endpoints are reached both directly (`/v1/embeddings`) and through the
 * pass-through proxy, which forwards whatever prefix the client used.
 */
export function requestTypeFromPath(path: string): RequestType | undefined {
  const clean = (path.split('?')[0] ?? '').toLowerCase();
  if (clean.includes('/chat/completions')) return 'chat';
  if (clean.includes('/responses')) return 'chat';
  if (clean.includes('/messages')) return 'chat';
  if (clean.includes('/completions')) return 'completion';
  if (clean.includes('/embeddings')) return 'embedding';
  if (clean.includes('/rerank')) return 'rerank';
  if (clean.includes('/images')) return 'image';
  if (clean.includes('/audio')) return 'audio';
  return undefined;
}

/**
 * Display label for a request type, for tables and filter buttons.
 *
 * `completion` reads as "Text Completion" so it never collides with the
 * `callType` label "completion", which means something else entirely (the
 * client's own call, as opposed to an internal routing or guardrail call).
 */
const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  chat: 'Chat',
  completion: 'Text Completion',
  embedding: 'Embedding',
  rerank: 'Rerank',
  image: 'Image',
  audio: 'Audio',
};

export function requestTypeLabel(type: RequestType): string {
  return REQUEST_TYPE_LABELS[type];
}

/**
 * Counterfactual for one baseline model (T61): what the compared traffic would
 * have cost, and how long it would have taken, had every client call gone to
 * this model instead of the one routing picked.
 */
export interface SavingsBaseline {
  modelId: string;
  /** The compared calls repriced at this model's rates, in USD. */
  cost: number;
  /** `cost - comparedCost`: money saved against this baseline. Negative means routing cost more. */
  costDelta: number;
  /** `costDelta` as a percentage of this baseline's cost. `0` when the baseline costs nothing. */
  costDeltaPercent: number;
  /**
   * Estimated total latency in ms, from this model's own throughput over the
   * same window. Absent when the model produced no output token in the window:
   * there is nothing to estimate from.
   */
  latencyMs?: number;
  /** `latencyMs - comparedLatencyMs`: time saved against this baseline. Absent with `latencyMs`. */
  latencyDeltaMs?: number;
  /** Calls of this model in the window that back the latency estimate. */
  latencySamples: number;
  /**
   * Input plus output tokens the same conversations are estimated to take on
   * this model, from the ratio between its tokenizer family and the family of
   * the model that actually served each call (T102).
   *
   * An estimate, not a measurement: prompts are not retained, so nothing is
   * re-tokenised. Every surface that shows it must say so.
   */
  tokensEstimated: number;
  /** `tokensEstimated - compared tokens`: tokens saved against this baseline. Positive means routing moved fewer. */
  tokenDelta: number;
}

/**
 * Measured saving of one optimizer over the compared calls (T63). Unlike the
 * baselines above this is not a counterfactual: the tokens were really removed
 * before the request left the gateway, and the money is those tokens priced at
 * the input rate of the model that actually served each call.
 */
export interface SavingsOptimizerEntry {
  id: OptimizerId;
  /** Calls where this optimizer ran and changed the prompt. */
  calls: number;
  /** Prompt tokens it removed, summed over those calls. */
  tokensSaved: number;
  /** USD those tokens would have cost at the serving model's input price. */
  costSaved: number;
  /** Calls where its output was rejected by the safety gate and rolled back. */
  rolledBack: number;
}

/**
 * One bucket of the savings series (T81): the compared calls of one hour or one
 * day, with what they cost and took and what the same calls would have cost and
 * taken on the baseline model.
 *
 * Totals rather than averages: they are additive, so a consumer can re-bucket
 * or average them without the service having to guess which it wanted.
 */
export interface UsageSeriesPoint {
  /** `YYYY-MM-DD` for a day bucket, `YYYY-MM-DDTHH` for an hour bucket. */
  bucket: string;
  /** Compared client calls in the bucket: the same set the savings summary counts. */
  calls: number;
  /** USD those calls actually cost. */
  cost: number;
  /** The same calls repriced at the costliest baseline model. `0` when there is no baseline. */
  baselineCost: number;
  /**
   * The same calls repriced at every paid baseline, keyed by model id (T100).
   * Empty when no baseline costs anything. The costliest entry is `baselineCost`.
   */
  baselineCosts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Summed end-to-end latency of those calls, in ms. */
  latencyMs: number;
  /** Estimated summed latency on the baseline model. `0` when it has no throughput sample. */
  baselineLatencyMs: number;
}

/** The savings series and what it is measured against (T81). */
export interface UsageSeries {
  bucket: 'hour' | 'day';
  /** Model the `baselineCost` and `baselineLatencyMs` fields are priced against: the costliest baseline. */
  baselineModelId?: string;
  /** Paid models `baselineCosts` is keyed by, cheapest first (T100). */
  baselineModelIds: string[];
  /** Oldest first, capped at the most recent 60 buckets. */
  points: UsageSeriesPoint[];
}

/**
 * Savings layer over a filtered set of usage records (T61). Shared by the
 * project dashboard, the CLI report and the overview: it is computed once,
 * server side, from whatever record set the usage filters produced.
 */
export interface SavingsSummary {
  /** Client calls the counterfactual covers: successful, with tokens, priced against a known model. */
  comparedCalls: number;
  /** What those calls actually cost, in USD. */
  comparedCost: number;
  /** What those calls actually took, in ms, summed. */
  comparedLatencyMs: number;
  comparedInputTokens: number;
  comparedOutputTokens: number;
  /** Prompt-cache savings already realised on the compared calls. */
  cache: {
    /** Input tokens served from cache instead of being charged at full input price. */
    inputTokens: number;
    /** USD those cached tokens saved against the same model's full input price. */
    cost: number;
  };
  /** One entry per baseline model, cheapest first. */
  baselines: SavingsBaseline[];
  /**
   * One entry per optimizer that changed at least one compared call, most
   * tokens saved first. Empty when no record in the window carries optimizer
   * stats: records written before 0.4.0 never do (T63).
   */
  optimizers: SavingsOptimizerEntry[];
}
