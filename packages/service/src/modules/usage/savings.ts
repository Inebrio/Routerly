import type {
  ModelConfig,
  OptimizerId,
  SavingsBaseline,
  SavingsOptimizerEntry,
  SavingsSummary,
  UsageRecord,
  UsageSeries,
  UsageSeriesPoint,
} from '@routerly/shared';
import { isCompletionCall } from '@routerly/shared';
import { calculateCost } from '../../lib/cost.js';

/** Median of a list. Returns 0 on an empty list, which every caller treats as "no estimate". */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const round = (n: number): number => Math.round(n * 1_000_000_000) / 1_000_000_000;

/**
 * A record enters the counterfactual only if repricing it means something:
 * a successful client call that actually moved tokens. Routing, guardrail and
 * judge calls are Routerly's own overhead, not the client's workload, and the
 * zero-token records the pass-through lane writes (T60) carry no tokens to
 * reprice at all.
 */
function isCompared(r: UsageRecord): boolean {
  if (r.outcome !== 'success') return false;
  if (!isCompletionCall(r.callType)) return false;
  return r.inputTokens + r.outputTokens > 0;
}

/**
 * How many tokens a tokenizer family spends on the same text, relative to
 * o200k at 1 (T102). Claude's tokenizer splits a little finer, the
 * SentencePiece families sit between the two, cl100k is slightly above o200k.
 *
 * Coarse on purpose: it exists so the savings layer can say "about this many
 * more tokens elsewhere" without shipping four vocabularies, and every surface
 * that shows the resulting figure labels it an estimate. First match wins, so
 * the modern OpenAI models are listed before the catch-all OpenAI rule.
 */
const TOKENIZER_RATIO: Array<[RegExp, number]> = [
  [/claude|anthropic/i, 1.15],
  [/gemini|palm|google/i, 1.05],
  [/qwen|llama|mistral|deepseek|phi|gemma|ollama/i, 1.1],
  [/gpt-4o|gpt-4\.1|gpt-5|\/o[134]\b/i, 1],
  [/gpt-|text-embedding|openai/i, 1.05],
];

/** Relative token cost of a model's tokenizer family. `1` when nothing matches. */
export function tokenizerRatio(modelId: string): number {
  return TOKENIZER_RATIO.find(([pattern]) => pattern.test(modelId))?.[1] ?? 1;
}

/**
 * Per-optimizer measured saving over the compared records (T63).
 *
 * Unlike the baselines this is not a counterfactual: the tokens listed here were
 * really removed from the prompt before it left the gateway. They are priced at
 * the input rate of the model that actually served the call, so an optimizer
 * that fires mostly on expensive models shows a bigger money figure than one
 * that fires as often on cheap ones.
 *
 * A step that was rolled back (safety gate or `validate` rejected it) saved
 * nothing, so it only feeds `rolledBack`: the count is what tells an operator a
 * threshold is set too aggressively.
 */
function computeOptimizerSavings(
  compared: UsageRecord[],
  byId: Map<string, ModelConfig>,
): SavingsOptimizerEntry[] {
  const entries = new Map<OptimizerId, SavingsOptimizerEntry>();
  const entryFor = (id: OptimizerId): SavingsOptimizerEntry => {
    const existing = entries.get(id);
    if (existing) return existing;
    const created: SavingsOptimizerEntry = { id, calls: 0, tokensSaved: 0, costSaved: 0, rolledBack: 0 };
    entries.set(id, created);
    return created;
  };

  for (const r of compared) {
    const inputPerMillion = byId.get(r.modelId)?.cost.inputPerMillion ?? 0;
    for (const stat of r.optimizers ?? []) {
      const entry = entryFor(stat.id);
      if (stat.rolledBack) {
        entry.rolledBack += 1;
        continue;
      }
      const saved = Math.max(0, stat.tokensBefore - stat.tokensAfter);
      entry.calls += 1;
      entry.tokensSaved += saved;
      entry.costSaved += (saved / 1_000_000) * inputPerMillion;
    }
  }

  return [...entries.values()]
    .map(e => ({ ...e, costSaved: round(e.costSaved) }))
    .sort((a, b) => b.tokensSaved - a.tokensSaved);
}

/**
 * Savings layer (T61). Answers two questions over an already filtered record
 * set: what the routed traffic actually cost and took, and what it would have
 * cost and taken had every client call gone to one fixed model instead.
 *
 * The money figure is exact arithmetic: the observed token counts repriced at
 * each baseline's rates. The time figure is an estimate: each baseline's own
 * median ms per output token over the same window, applied to the compared
 * output tokens. A baseline that produced no output token in the window gets no
 * time estimate rather than a made-up one.
 *
 * ponytail: repricing assumes the same workload produces the same token counts
 * on every model. Tokenizers and answer lengths differ, so read the money delta
 * as "the same conversation, priced elsewhere", not as a replay. Measuring the
 * real thing needs a live A/B run, which is what Experiments are for.
 */
export function computeSavings(
  records: UsageRecord[],
  models: ModelConfig[],
  baselineModelIds: string[],
): SavingsSummary {
  const byId = new Map(models.map(m => [m.id, m]));
  const compared = records.filter(isCompared);

  let comparedCost = 0;
  let comparedLatencyMs = 0;
  let comparedInputTokens = 0;
  let comparedOutputTokens = 0;
  let cacheTokens = 0;
  let cacheCost = 0;

  for (const r of compared) {
    comparedCost += r.cost;
    comparedLatencyMs += r.latencyMs;
    comparedInputTokens += r.inputTokens;
    comparedOutputTokens += r.outputTokens;

    // Prompt-cache saving already banked: cached input tokens cost the cache
    // rate instead of the full input rate on the model that served them.
    const cached = r.cachedInputTokens ?? 0;
    if (cached > 0) {
      const model = byId.get(r.modelId);
      if (model) {
        const full = model.cost.inputPerMillion;
        const cachedRate = model.cost.cachePerMillion ?? full;
        cacheTokens += cached;
        cacheCost += (cached / 1_000_000) * (full - cachedRate);
      }
    }
  }

  // Observed throughput per model, from its own successful calls in the window.
  const msPerOutputToken = new Map<string, { value: number; samples: number }>();
  for (const modelId of new Set(baselineModelIds)) {
    const observed = records.filter(r => r.modelId === modelId && r.outcome === 'success' && r.outputTokens > 0);
    msPerOutputToken.set(modelId, {
      value: median(observed.map(r => r.latencyMs / r.outputTokens)),
      samples: observed.length,
    });
  }

  const baselines: SavingsBaseline[] = [];
  for (const modelId of new Set(baselineModelIds)) {
    const model = byId.get(modelId);
    if (!model) continue; // a target model that no longer exists cannot be priced
    const cost = round(compared.reduce(
      (sum, r) => sum + calculateCost(r.inputTokens, r.outputTokens, model, r.cachedInputTokens, r.cacheCreationInputTokens),
      0,
    ));
    // Positive delta means the routed traffic came out cheaper than the baseline.
    const costDelta = round(cost - comparedCost);
    const throughput = msPerOutputToken.get(modelId)!;
    const latencyMs = throughput.samples > 0 ? Math.round(throughput.value * comparedOutputTokens) : undefined;
    // Token counterfactual (T102): the observed tokens rescaled by the ratio
    // between this model's tokenizer family and the family that served the call.
    const baselineRatio = tokenizerRatio(modelId);
    const tokensEstimated = Math.round(compared.reduce(
      (sum, r) => sum + (r.inputTokens + r.outputTokens) * (baselineRatio / tokenizerRatio(r.modelId)),
      0,
    ));
    baselines.push({
      modelId,
      cost,
      costDelta,
      costDeltaPercent: cost > 0 ? round((costDelta / cost) * 100) : 0,
      ...(latencyMs !== undefined ? { latencyMs, latencyDeltaMs: latencyMs - comparedLatencyMs } : {}),
      latencySamples: throughput.samples,
      tokensEstimated,
      tokenDelta: tokensEstimated - (comparedInputTokens + comparedOutputTokens),
    });
  }
  baselines.sort((a, b) => a.cost - b.cost);

  return {
    comparedCalls: compared.length,
    comparedCost: round(comparedCost),
    comparedLatencyMs,
    comparedInputTokens,
    comparedOutputTokens,
    cache: { inputTokens: cacheTokens, cost: round(cacheCost) },
    baselines,
    optimizers: computeOptimizerSavings(compared, byId),
  };
}

/** Bucket key of a record: `YYYY-MM-DDTHH` by hour, `YYYY-MM-DD` by day. */
const bucketKey = (timestamp: string, bucket: 'hour' | 'day'): string =>
  bucket === 'hour' ? timestamp.slice(0, 13) : timestamp.slice(0, 10);

/**
 * The savings summary spread over time (T81). Same compared record set, same
 * arithmetic, cut into hour or day buckets so the overview can show whether the
 * gap between routed and baseline traffic is widening or closing.
 *
 * Every paid baseline is priced, not only the costliest: the overview draws one
 * line per model and lets the reader turn any of them off (T100). Free models
 * are left out, a flat zero line says nothing. `baselineCost` stays the
 * costliest of them, the headline the project dashboard and the CLI already read.
 *
 * Per-bucket baseline latency reuses the costliest baseline's whole-window
 * throughput (`latencyMs / comparedOutputTokens`) rather than recomputing a
 * median per bucket, where a quiet hour would rest on one or two calls.
 *
 * Buckets with no compared call are absent rather than zero-filled: a gap in the
 * line is honest about there being no traffic, a zero would read as free traffic.
 */
export function computeSeries(
  records: UsageRecord[],
  models: ModelConfig[],
  summary: SavingsSummary,
  bucket: 'hour' | 'day',
): UsageSeries {
  // Baselines come out cheapest first, so the costliest is the last one.
  const worst = summary.baselines[summary.baselines.length - 1];
  const baselineModel = worst ? models.find(m => m.id === worst.modelId) : undefined;
  const msPerOutputToken = worst?.latencyMs !== undefined && summary.comparedOutputTokens > 0
    ? worst.latencyMs / summary.comparedOutputTokens
    : 0;

  // Cheapest first, same order as the summary, so a legend built from this list
  // reads from the low end of the range to the high one.
  const priced = summary.baselines
    .filter(b => b.cost > 0)
    .map(b => models.find(m => m.id === b.modelId))
    .filter((m): m is ModelConfig => m !== undefined);

  const buckets = new Map<string, UsageSeriesPoint>();
  for (const r of records.filter(isCompared)) {
    const key = bucketKey(r.timestamp, bucket);
    let point = buckets.get(key);
    if (!point) {
      point = {
        bucket: key, calls: 0, cost: 0, baselineCost: 0, baselineCosts: {},
        inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
        latencyMs: 0, baselineLatencyMs: 0,
      };
      buckets.set(key, point);
    }
    point.calls += 1;
    point.cost += r.cost;
    point.inputTokens += r.inputTokens;
    point.outputTokens += r.outputTokens;
    point.cachedInputTokens += r.cachedInputTokens ?? 0;
    point.latencyMs += r.latencyMs;
    if (baselineModel) {
      point.baselineCost += calculateCost(
        r.inputTokens, r.outputTokens, baselineModel, r.cachedInputTokens, r.cacheCreationInputTokens,
      );
    }
    for (const model of priced) {
      point.baselineCosts[model.id] = (point.baselineCosts[model.id] ?? 0) + calculateCost(
        r.inputTokens, r.outputTokens, model, r.cachedInputTokens, r.cacheCreationInputTokens,
      );
    }
    point.baselineLatencyMs += msPerOutputToken * r.outputTokens;
  }

  const points = [...buckets.values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .slice(-60)
    .map(p => ({
      ...p,
      cost: round(p.cost),
      baselineCost: round(p.baselineCost),
      baselineCosts: Object.fromEntries(Object.entries(p.baselineCosts).map(([id, c]) => [id, round(c)])),
      baselineLatencyMs: Math.round(p.baselineLatencyMs),
    }));

  return {
    bucket,
    ...(baselineModel ? { baselineModelId: baselineModel.id } : {}),
    baselineModelIds: priced.map(m => m.id),
    points,
  };
}
