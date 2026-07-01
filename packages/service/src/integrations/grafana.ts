import type { GrafanaIntegration } from '@routerly/shared';
import type { getMetricsSnapshot } from './metrics-snapshot.js';
import {
  percentile,
  projectBudgetRatio,
  renderMetric,
  type Metric,
  type Sample,
} from './metrics-snapshot.js';

type Snapshot = Awaited<ReturnType<typeof getMetricsSnapshot>>;

export async function pushGrafana(integration: GrafanaIntegration, snapshot: Snapshot): Promise<void> {
  const { agg, projects, models } = snapshot;

  const p50Samples: Sample[] = [];
  const p95Samples: Sample[] = [];
  for (const d of agg.durations.values()) {
    const sorted = [...d.latencies].sort((a, b) => a - b);
    p50Samples.push({ labels: d.labels, value: percentile(sorted, 50) });
    p95Samples.push({ labels: d.labels, value: percentile(sorted, 95) });
  }

  const budgetSamples: Sample[] = [];
  for (const project of projects) {
    const ratio = await projectBudgetRatio(project, models);
    budgetSamples.push({ labels: { project: project.name }, value: +ratio.toFixed(6) });
  }

  const metrics: Metric[] = [
    { name: 'routerly_requests_total', help: 'Total requests', type: 'counter', samples: [...agg.requests.values()].map((e) => ({ labels: e.labels, value: e.value })) },
    { name: 'routerly_tokens_total', help: 'Total tokens by type', type: 'counter', samples: [...agg.tokens.values()].map((e) => ({ labels: e.labels, value: e.value })) },
    { name: 'routerly_cost_usd_total', help: 'Total cost in USD', type: 'counter', samples: [...agg.cost.values()].map((e) => ({ labels: e.labels, value: +e.value.toFixed(6) })) },
    { name: 'routerly_request_duration_p50_ms', help: 'Request duration p50 in ms (last 100 records)', type: 'gauge', samples: p50Samples },
    { name: 'routerly_request_duration_p95_ms', help: 'Request duration p95 in ms (last 100 records)', type: 'gauge', samples: p95Samples },
    { name: 'routerly_budget_used_ratio', help: 'Budget used ratio per project (0-1)', type: 'gauge', samples: budgetSamples },
  ];

  const body = metrics.map(renderMetric).join('\n\n').concat('\n');
  const auth = Buffer.from(`${integration.username}:${integration.apiKey}`).toString('base64');

  await fetch(integration.url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
    body,
  });
}
