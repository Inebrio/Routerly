import type {
  ExperimentConfig,
  ExperimentMetrics,
  ExperimentVariantMetrics,
  RouterConfig,
  UsageRecord,
} from '@routerly/shared';
import { DEFAULT_MIN_SAMPLES_PER_VARIANT, isCompletionCall } from '@routerly/shared';

/** 95th percentile of a list, 0 when empty. Same nearest-rank method the usage route uses. */
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

/**
 * Reads the experiment's arms out of the usage log.
 *
 * Pure: it takes the records rather than loading them, so the route decides the
 * window and the tests stay honest. Only calls the experiment itself routed are
 * counted, and only the client's own calls: the router's own decisions, the
 * guardrail passes and the judge's verdicts are gateway overhead and would make
 * the cheap variant look expensive for no reason the operator can act on.
 */
export function computeExperimentMetrics(
  experiment: ExperimentConfig,
  records: UsageRecord[],
  routers: RouterConfig[] = [],
): ExperimentMetrics {
  const minSamples = experiment.minSamplesPerVariant ?? DEFAULT_MIN_SAMPLES_PER_VARIANT;
  const mine = records.filter(r => r.experimentId === experiment.id && isCompletionCall(r.callType));

  const variants: ExperimentVariantMetrics[] = experiment.variants.map(variant => {
    const rows = mine.filter(r => r.experimentVariantId === variant.id);
    const errors = rows.filter(r => r.outcome !== 'success' && r.outcome !== 'blocked').length;
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    const latencies = rows.map(r => r.latencyMs).filter((n): n is number => typeof n === 'number');
    const ttfts = rows.map(r => r.ttftMs).filter((n): n is number => typeof n === 'number');
    // The judge keeps a running tally on the experiment, not a score per usage
    // record, so this pair is lifetime while everything else follows the window.
    const tally = experiment.judgeScores?.[variant.id];
    const name = variant.name ?? routers.find(p => p.id === variant.routerId)?.name;

    return {
      variantId: variant.id,
      routerId: variant.routerId,
      ...(name !== undefined ? { name } : {}),
      calls: rows.length,
      errors,
      errorRate: rows.length > 0 ? errors / rows.length : 0,
      cost,
      avgCostPerCall: rows.length > 0 ? cost / rows.length : 0,
      inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      avgLatencyMs: avg(latencies),
      p95LatencyMs: p95(latencies),
      ...(ttfts.length > 0 ? { avgTtftMs: avg(ttfts) } : {}),
      judgedCalls: tally?.count ?? 0,
      ...(tally && tally.count > 0 ? { avgScore: tally.totalScore / tally.count } : {}),
      enoughSamples: rows.length >= minSamples,
    };
  });

  return {
    experimentId: experiment.id,
    minSamplesPerVariant: minSamples,
    totalCalls: mine.length,
    variants,
    // An experiment with no variants is never ready: there is nothing to compare.
    ready: variants.length > 0 && variants.every(v => v.enoughSamples),
  };
}
