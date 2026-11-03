import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);

import { pushDatadog } from './datadog.js';

const integration = {
  id: '1',
  type: 'datadog' as const,
  enabled: true,
  apiKey: 'dd-key',
  site: 'datadoghq.com' as const,
};

const snapshot = {
  agg: {
    requests: new Map([['k', { labels: { router: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 3 }]]),
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

describe('pushDatadog', () => {
  it('POSTs to datadoghq.com with DD-API-KEY header and series body', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await pushDatadog(integration, snapshot);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.datadoghq.com/api/v2/series');
    expect((opts.headers as Record<string, string>)['DD-API-KEY']).toBe('dd-key');

    const body = JSON.parse(opts.body as string) as { series: { metric: string; type: number }[] };
    expect(body.series.some((s) => s.metric === 'routerly.requests.total' && s.type === 1)).toBe(true);
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('dd unreachable'));
    await expect(pushDatadog(integration, snapshot)).rejects.toThrow('dd unreachable');
  });

  it('includes token, cost and duration series when maps are non-empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const richSnapshot = {
      agg: {
        requests: new Map([['r', { labels: { router: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 3 }]]),
        tokens: new Map([['t', { labels: { router: 'P', model: 'M', provider: 'openai', type: 'input' }, value: 100 }]]),
        cost: new Map([['c', { labels: { router: 'P', model: 'M', provider: 'openai' }, value: 0.005 }]]),
        durations: new Map([['d', { labels: { router: 'P', model: 'M' }, latencies: [10, 20, 30, 40, 50] }]]),
      },
      routerName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
      routers: [],
      models: [],
    };

    await pushDatadog(integration, richSnapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { series: { metric: string }[] };
    expect(body.series.some((s) => s.metric === 'routerly.tokens.total')).toBe(true);
    expect(body.series.some((s) => s.metric === 'routerly.cost.usd.total')).toBe(true);
    expect(body.series.some((s) => s.metric === 'routerly.request.duration.p50.ms')).toBe(true);
    expect(body.series.some((s) => s.metric === 'routerly.request.duration.p95.ms')).toBe(true);
  });
});
