import type { ModelConfig, RouterConfig, UsageRecord } from '@routerly/shared';
import { readConfig } from '../../modules/config/loader.js';
import { listEffectiveModelsIncludingDisabled } from '../../modules/provider/list-effective.js';
import { getLimitUsageSnapshot } from '../../modules/budget/budget.js';

// ─── Prometheus text-format helpers ──────────────────────────────────────────

export function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const inner = keys.map((k) => `${k}="${escapeLabel(labels[k] ?? '')}"`).join(',');
  return `{${inner}}`;
}

export interface Sample {
  labels: Record<string, string>;
  value: number;
}

export interface Metric {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  samples: Sample[];
}

export function renderMetric(m: Metric): string {
  const lines = [`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`];
  for (const s of m.samples) {
    lines.push(`${m.name}${renderLabels(s.labels)} ${s.value}`);
  }
  return lines.join('\n');
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)] ?? 0;
}

export interface Aggregates {
  requests: Map<string, { labels: Record<string, string>; value: number }>;
  tokens: Map<string, { labels: Record<string, string>; value: number }>;
  cost: Map<string, { labels: Record<string, string>; value: number }>;
  durations: Map<string, { labels: Record<string, string>; latencies: number[] }>;
}

export const DURATION_WINDOW = 100;

export function aggregate(
  usage: UsageRecord[],
  routerName: (id: string) => string,
  modelInfo: (id: string) => { model: string; provider: string },
): Aggregates {
  const requests = new Map<string, { labels: Record<string, string>; value: number }>();
  const tokens = new Map<string, { labels: Record<string, string>; value: number }>();
  const cost = new Map<string, { labels: Record<string, string>; value: number }>();
  const durations = new Map<string, { labels: Record<string, string>; latencies: number[] }>();

  const bump = (
    map: Map<string, { labels: Record<string, string>; value: number }>,
    labels: Record<string, string>,
    delta: number,
  ): void => {
    const key = JSON.stringify(labels);
    const entry = map.get(key);
    if (entry) entry.value += delta;
    else map.set(key, { labels, value: delta });
  };

  for (const r of usage) {
    const router = routerName(r.routerId);
    const { model, provider } = modelInfo(r.modelId);

    bump(requests, { router, model, provider, status: r.outcome }, 1);

    bump(tokens, { router, model, type: 'input' }, r.inputTokens);
    bump(tokens, { router, model, type: 'output' }, r.outputTokens);
    if (r.cachedInputTokens) bump(tokens, { router, model, type: 'cached' }, r.cachedInputTokens);

    bump(cost, { router, model }, r.cost);

    const dKey = `${router} ${model}`;
    const d = durations.get(dKey) ?? { labels: { router, model }, latencies: [] };
    d.latencies.push(r.latencyMs);
    if (d.latencies.length > DURATION_WINDOW) d.latencies.shift();
    durations.set(dKey, d);
  }

  return { requests, tokens, cost, durations };
}

// ─── Budget ratio ─────────────────────────────────────────────────────────────

export async function routerBudgetRatio(router: RouterConfig, models: ModelConfig[]): Promise<number> {
  let maxRatio = 0;
  for (const ref of router.models) {
    const model = models.find((m) => m.id === ref.modelId);
    if (!model) continue;
    const snapshots = await getLimitUsageSnapshot(model, router);
    for (const s of snapshots) {
      if (s.metric !== 'cost' || s.value <= 0) continue;
      const ratio = Math.min(1, s.current / s.value);
      if (ratio > maxRatio) maxRatio = ratio;
    }
  }
  return maxRatio;
}

// ─── Top-level snapshot ───────────────────────────────────────────────────────

export async function getMetricsSnapshot(): Promise<{
  agg: Aggregates;
  routerName: (id: string) => string;
  modelInfo: (id: string) => { model: string; provider: string };
  routers: RouterConfig[];
  models: ModelConfig[];
}> {
  // observability: must still account for disabled-connection models
  const [usage, routers, models] = await Promise.all([
    readConfig('usage'),
    readConfig('routers'),
    listEffectiveModelsIncludingDisabled(),
  ]);

  const routerName = (id: string): string => routers.find((p) => p.id === id)?.name ?? id;
  const modelInfo = (id: string): { model: string; provider: string } => {
    const m = models.find((mm) => mm.id === id);
    return { model: id, provider: m?.provider ?? 'unknown' };
  };

  const agg = aggregate(usage as UsageRecord[], routerName, modelInfo);

  return { agg, routerName, modelInfo, routers, models };
}
