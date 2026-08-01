import type {
  ModelConfig,
  OptimizerId,
  SavingsBaseline,
  SavingsOptimizerEntry,
  SavingsSummary,
  UsageRecord,
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
    baselines.push({
      modelId,
      cost,
      costDelta,
      costDeltaPercent: cost > 0 ? round((costDelta / cost) * 100) : 0,
      ...(latencyMs !== undefined ? { latencyMs, latencyDeltaMs: latencyMs - comparedLatencyMs } : {}),
      latencySamples: throughput.samples,
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
