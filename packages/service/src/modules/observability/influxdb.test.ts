import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);

import { pushInfluxDB } from './influxdb.js';

const integration = {
  id: '1',
  type: 'influxdb' as const,
  enabled: true,
  url: 'http://influx.local',
  token: 'influx-token',
  org: 'my org',
  bucket: 'my bucket',
};

const snapshot = {
  agg: {
    requests: new Map([['k', { labels: { router: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 7 }]]),
    tokens: new Map(),
    cost: new Map(),
    durations: new Map(),
  },
  routerName: (id: string) => id,
  modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
  routers: [],
  models: [],
};

beforeEach(() => vi.clearAllMocks());

describe('pushInfluxDB', () => {
  it('POSTs to /api/v2/write with correct URL, token auth, and line protocol body', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await pushInfluxDB(integration, snapshot);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v2/write');
    expect(url).toContain('org=my%20org');
    expect(url).toContain('bucket=my%20bucket');
    expect(url).toContain('precision=s');

    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Token influx-token');
    expect(opts.body as string).toContain('routerly_requests_total');
    expect(opts.body as string).toContain('value=7');
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('influx down'));
    await expect(pushInfluxDB(integration, snapshot)).rejects.toThrow('influx down');
  });

  it('includes token, cost and duration lines when maps are non-empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const richSnapshot = {
      agg: {
        requests: new Map([['r', { labels: { router: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 7 }]]),
        tokens: new Map([['t', { labels: { router: 'P', model: 'M', type: 'input' }, value: 100 }]]),
        cost: new Map([['c', { labels: { router: 'P', model: 'M' }, value: 0.005 }]]),
        durations: new Map([['d', { labels: { router: 'P', model: 'M' }, latencies: [10, 20, 30, 40, 50] }]]),
      },
      routerName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
      routers: [],
      models: [],
    };

    await pushInfluxDB(integration, richSnapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.body as string).toContain('routerly_tokens_total');
    expect(opts.body as string).toContain('routerly_cost_usd_total');
    expect(opts.body as string).toContain('routerly_request_duration_p50_ms');
    expect(opts.body as string).toContain('routerly_request_duration_p95_ms');
  });

  it('builds line without tags when labels is empty (line 20 branch=1)', async () => {
    // empty labels → tags = '' → tagStr = '' (not `,${tags}`) → no tag set in line protocol
    mockFetch.mockResolvedValue({ ok: true });
    const emptyLabelSnapshot = {
      ...snapshot,
      agg: {
        ...snapshot.agg,
        requests: new Map([['k', { labels: {} as Record<string, string>, value: 5 }]]),
      },
    };
    await pushInfluxDB(integration, emptyLabelSnapshot);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    // No comma before value (no tags) — line looks like "measurement value=5 ts"
    expect(opts.body as string).toContain('routerly_requests_total value=5');
    expect(opts.body as string).not.toContain('routerly_requests_total,');
  });
});
