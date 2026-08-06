import type { DatadogIntegration } from '@routerly/shared';
import type { getMetricsSnapshot } from './metrics-snapshot.js';
import { percentile } from './metrics-snapshot.js';

type Snapshot = Awaited<ReturnType<typeof getMetricsSnapshot>>;

function toTags(labels: Record<string, string>): string[] {
  return Object.entries(labels).map(([k, v]) => `${k}:${v}`);
}

export async function pushDatadog(integration: DatadogIntegration, snapshot: Snapshot): Promise<void> {
  const { agg } = snapshot;
  const timestamp = Math.floor(Date.now() / 1000);

  // ponytail: type 1=COUNT, 3=GAUGE per Datadog v2 series API
  const series: unknown[] = [];

  const addCount = (metric: string, entries: { labels: Record<string, string>; value: number }[]) => {
    for (const e of entries) {
      series.push({ metric, type: 1, points: [{ timestamp, value: e.value }], tags: toTags(e.labels) });
    }
  };

  const addGauge = (metric: string, samples: { labels: Record<string, string>; value: number }[]) => {
    for (const s of samples) {
      series.push({ metric, type: 3, points: [{ timestamp, value: s.value }], tags: toTags(s.labels) });
    }
  };

  addCount('routerly.requests.total', [...agg.requests.values()]);
  addCount('routerly.tokens.total', [...agg.tokens.values()]);
  addCount('routerly.cost.usd.total', [...agg.cost.values()].map((e) => ({ labels: e.labels, value: +e.value.toFixed(6) })));

  const p50: { labels: Record<string, string>; value: number }[] = [];
  const p95: { labels: Record<string, string>; value: number }[] = [];
  for (const d of agg.durations.values()) {
    const sorted = [...d.latencies].sort((a, b) => a - b);
    p50.push({ labels: d.labels, value: percentile(sorted, 50) });
    p95.push({ labels: d.labels, value: percentile(sorted, 95) });
  }
  addGauge('routerly.request.duration.p50.ms', p50);
  addGauge('routerly.request.duration.p95.ms', p95);

  await fetch(`https://api.${integration.site}/api/v2/series`, {
    method: 'POST',
    headers: {
      'DD-API-KEY': integration.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ series }),
  });
}
