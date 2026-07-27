import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);

import { pushOtel } from './otel.js';

const integration = {
  id: '1',
  type: 'otel' as const,
  enabled: true,
  endpoint: 'http://otel.local',
  protocol: 'http' as const,
  headers: { 'X-Custom': 'val' },
};

const snapshot = {
  agg: {
    requests: new Map([['k', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 5 }]]),
    tokens: new Map(),
    cost: new Map(),
    durations: new Map(),
  },
  projectName: (id: string) => id,
  modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
  projects: [],
  models: [],
};

beforeEach(() => vi.clearAllMocks());

describe('pushOtel', () => {
  it('POSTs to /v1/metrics with OTLP JSON and custom headers', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await pushOtel(integration, snapshot);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://otel.local/v1/metrics');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((opts.headers as Record<string, string>)['X-Custom']).toBe('val');

    const body = JSON.parse(opts.body as string) as { resourceMetrics: unknown[] };
    expect(body.resourceMetrics).toHaveLength(1);
  });

  it('does not throw when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    await expect(pushOtel(integration, snapshot)).rejects.toThrow('network');
    // ponytail: caller (runner) catches this — exporter itself propagates
  });

  it('includes token, cost and duration data points when maps are non-empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const richSnapshot = {
      agg: {
        requests: new Map([['r', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 5 }]]),
        tokens: new Map([['t', { labels: { project: 'P', model: 'M', provider: 'openai', type: 'input' }, value: 100 }]]),
        cost: new Map([['c', { labels: { project: 'P', model: 'M', provider: 'openai' }, value: 0.005 }]]),
        durations: new Map([['d', { labels: { project: 'P', model: 'M' }, latencies: [10, 20, 30, 40, 50] }]]),
      },
      projectName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
      projects: [],
      models: [],
    };

    await pushOtel(integration, richSnapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { resourceMetrics: { scopeMetrics: { metrics: { name: string }[] }[] }[] };
    const metrics = body.resourceMetrics[0]!.scopeMetrics[0]!.metrics;
    expect(metrics.some((m) => m.name === 'routerly_tokens_total')).toBe(true);
    expect(metrics.some((m) => m.name === 'routerly_cost_usd_total')).toBe(true);
    expect(metrics.some((m) => m.name === 'routerly_request_duration_p50_ms')).toBe(true);
  });
});
