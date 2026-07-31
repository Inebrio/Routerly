import type { OtelIntegration } from '@routerly/shared';
import type { getMetricsSnapshot } from './metrics-snapshot.js';
import { percentile } from './metrics-snapshot.js';
import { SERVICE_VERSION } from '../telemetry/telemetry.js';

type Snapshot = Awaited<ReturnType<typeof getMetricsSnapshot>>;

function toAttrs(labels: Record<string, string>): { key: string; value: { stringValue: string } }[] {
  return Object.entries(labels).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

const nowNs = (): string => String(BigInt(Date.now()) * 1_000_000n);

export async function pushOtel(integration: OtelIntegration, snapshot: Snapshot): Promise<void> {
  const { agg } = snapshot;
  const ts = nowNs();

  const sumMetric = (
    name: string,
    description: string,
    entries: { labels: Record<string, string>; value: number }[],
  ) => ({
    name,
    description,
    sum: {
      dataPoints: entries.map((e) => ({
        attributes: toAttrs(e.labels),
        asDouble: e.value,
        startTimeUnixNano: '0',
        timeUnixNano: ts,
      })),
      aggregationTemporality: 2,
      isMonotonic: true,
    },
  });

  const gaugeMetric = (
    name: string,
    description: string,
    samples: { labels: Record<string, string>; value: number }[],
  ) => ({
    name,
    description,
    gauge: {
      dataPoints: samples.map((s) => ({
        attributes: toAttrs(s.labels),
        asDouble: s.value,
        startTimeUnixNano: '0',
        timeUnixNano: ts,
      })),
    },
  });

  const p50: { labels: Record<string, string>; value: number }[] = [];
  const p95: { labels: Record<string, string>; value: number }[] = [];
  for (const d of agg.durations.values()) {
    const sorted = [...d.latencies].sort((a, b) => a - b);
    p50.push({ labels: d.labels, value: percentile(sorted, 50) });
    p95.push({ labels: d.labels, value: percentile(sorted, 95) });
  }

  const metrics = [
    sumMetric('routerly_requests_total', 'Total requests', [...agg.requests.values()]),
    sumMetric('routerly_tokens_total', 'Total tokens by type', [...agg.tokens.values()]),
    sumMetric(
      'routerly_cost_usd_total',
      'Total cost in USD',
      [...agg.cost.values()].map((e) => ({ labels: e.labels, value: +e.value.toFixed(6) })),
    ),
    gaugeMetric('routerly_request_duration_p50_ms', 'Request duration p50 in ms', p50),
    gaugeMetric('routerly_request_duration_p95_ms', 'Request duration p95 in ms', p95),
  ];

  const body = JSON.stringify({
    resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'routerly' } }] },
      scopeMetrics: [{
        scope: { name: 'routerly', version: SERVICE_VERSION },
        metrics,
      }],
    }],
  });

  await fetch(`${integration.endpoint}/v1/metrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...integration.headers,
    },
    body,
  });
}
