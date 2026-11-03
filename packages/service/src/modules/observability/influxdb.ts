import type { InfluxDBIntegration } from '@routerly/shared';
import type { getMetricsSnapshot } from './metrics-snapshot.js';
import { percentile } from './metrics-snapshot.js';

type Snapshot = Awaited<ReturnType<typeof getMetricsSnapshot>>;

function escapeTag(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/ /g, '\\ ').replace(/,/g, '\\,').replace(/=/g, '\\=');
}

function line(
  measurement: string,
  labels: Record<string, string>,
  value: number,
  ts: number,
): string {
  const tags = Object.entries(labels)
    .map(([k, v]) => `${escapeTag(k)}=${escapeTag(v)}`)
    .join(',');
  const tagStr = tags ? `,${tags}` : '';
  return `${measurement}${tagStr} value=${value} ${ts}`;
}

export async function pushInfluxDB(integration: InfluxDBIntegration, snapshot: Snapshot): Promise<void> {
  const { agg } = snapshot;
  const ts = Math.floor(Date.now() / 1000);
  const lines: string[] = [];

  for (const e of agg.requests.values()) {
    lines.push(line('routerly_requests_total', e.labels, e.value, ts));
  }
  for (const e of agg.tokens.values()) {
    lines.push(line('routerly_tokens_total', e.labels, e.value, ts));
  }
  for (const e of agg.cost.values()) {
    lines.push(line('routerly_cost_usd_total', e.labels, +e.value.toFixed(6), ts));
  }

  for (const d of agg.durations.values()) {
    const sorted = [...d.latencies].sort((a, b) => a - b);
    lines.push(line('routerly_request_duration_p50_ms', d.labels, percentile(sorted, 50), ts));
    lines.push(line('routerly_request_duration_p95_ms', d.labels, percentile(sorted, 95), ts));
  }

  const { org, bucket } = integration;
  const url = `${integration.url}/api/v2/write?org=${encodeURIComponent(org)}&bucket=${encodeURIComponent(bucket)}&precision=s`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${integration.token}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: lines.join('\n'),
  });
}
