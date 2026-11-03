import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch, mockBudgetRatio } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockBudgetRatio: vi.fn(),
}));
vi.stubGlobal('fetch', mockFetch);
vi.mock('./metrics-snapshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./metrics-snapshot.js')>();
  return { ...actual, routerBudgetRatio: mockBudgetRatio };
});

import { pushGrafana } from './grafana.js';

const integration = {
  id: '1',
  type: 'grafana' as const,
  enabled: true,
  url: 'http://grafana.local/push',
  username: 'user1',
  apiKey: 'grafana-key',
};

const snapshot = {
  agg: {
    requests: new Map([['k', { labels: { router: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 2 }]]),
    tokens: new Map(),
    cost: new Map(),
    durations: new Map(),
  },
  routerName: (id: string) => id,
  modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
  routers: [],
  models: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBudgetRatio.mockResolvedValue(0);
});

describe('pushGrafana', () => {
  it('POSTs to grafana url with Basic auth and text/plain body', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await pushGrafana(integration, snapshot);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://grafana.local/push');

    const expectedAuth = 'Basic ' + Buffer.from('user1:grafana-key').toString('base64');
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(expectedAuth);
    const h = opts.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/x-protobuf');
    expect(h['Content-Encoding']).toBe('snappy');
    expect(h['X-Prometheus-Remote-Write-Version']).toBe('0.1.0');
    expect(Buffer.isBuffer(opts.body)).toBe(true);
    // literal-only snappy: the series name is present verbatim in the payload
    expect((opts.body as Buffer).toString('latin1')).toContain('routerly_requests_total');
  });

  it('throws on a non-2xx response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });
    await expect(pushGrafana(integration, snapshot)).rejects.toThrow('HTTP 400');
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('grafana down'));
    await expect(pushGrafana(integration, snapshot)).rejects.toThrow('grafana down');
  });

  it('includes token, cost, duration and budget lines when maps/routers are non-empty', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    mockBudgetRatio.mockResolvedValue(0.5);

    const richSnapshot = {
      agg: {
        requests: new Map([['r', { labels: { router: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 2 }]]),
        tokens: new Map([['t', { labels: { router: 'P', model: 'M', provider: 'openai', type: 'input' }, value: 100 }]]),
        cost: new Map([['c', { labels: { router: 'P', model: 'M', provider: 'openai' }, value: 0.005 }]]),
        durations: new Map([['d', { labels: { router: 'P', model: 'M' }, latencies: [10, 20, 30, 40, 50] }]]),
      },
      routerName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
      routers: [{ id: 'proj1', name: 'Router One', models: [] } as unknown as import('@routerly/shared').RouterConfig],
      models: [],
    };

    await pushGrafana(integration, richSnapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const text = (opts.body as Buffer).toString('latin1');
    for (const n of ['routerly_tokens_total', 'routerly_cost_usd_total', 'routerly_request_duration_p50_ms', 'routerly_budget_used_ratio']) expect(text).toContain(n);
  });
});
