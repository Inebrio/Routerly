import { createHmac } from 'node:crypto';
import type { WebhookIntegration } from '@routerly/shared';
import type { getMetricsSnapshot } from './metrics-snapshot.js';
import { percentile } from './metrics-snapshot.js';

type Snapshot = Awaited<ReturnType<typeof getMetricsSnapshot>>;

export async function pushWebhook(integration: WebhookIntegration, snapshot: Snapshot): Promise<void> {
  const { agg } = snapshot;

  const p50: { labels: Record<string, string>; value: number }[] = [];
  const p95: { labels: Record<string, string>; value: number }[] = [];
  for (const d of agg.durations.values()) {
    const sorted = [...d.latencies].sort((a, b) => a - b);
    p50.push({ labels: d.labels, value: percentile(sorted, 50) });
    p95.push({ labels: d.labels, value: percentile(sorted, 95) });
  }

  const payload = {
    source: 'routerly',
    timestamp: new Date().toISOString(),
    metrics: {
      requests: [...agg.requests.values()].map((e) => ({ labels: e.labels, value: e.value })),
      tokens: [...agg.tokens.values()].map((e) => ({ labels: e.labels, value: e.value })),
      cost: [...agg.cost.values()].map((e) => ({ labels: e.labels, value: +e.value.toFixed(6) })),
      latency_p50_ms: p50,
      latency_p95_ms: p95,
      budget_ratio: [] as { labels: Record<string, string>; value: number }[],
    },
  };

  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...integration.headers,
  };

  if (integration.secret) {
    const sig = createHmac('sha256', integration.secret).update(body).digest('hex');
    headers['X-Routerly-Signature'] = `sha256=${sig}`;
  }

  await fetch(integration.url, { method: 'POST', headers, body });
}
