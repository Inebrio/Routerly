import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch, mockBudgetRatio } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockBudgetRatio: vi.fn(),
}));
vi.stubGlobal('fetch', mockFetch);
vi.mock('./metrics-snapshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./metrics-snapshot.js')>();
  return { ...actual, projectBudgetRatio: mockBudgetRatio };
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
    requests: new Map([['k', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 2 }]]),
    tokens: new Map(),
    cost: new Map(),
    durations: new Map(),
  },
  projectName: (id: string) => id,
  modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
  projects: [],
  models: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBudgetRatio.mockResolvedValue(0);
});

describe('pushGrafana', () => {
  it('POSTs to grafana url with Basic auth and text/plain body', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await pushGrafana(integration, snapshot);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://grafana.local/push');

    const expectedAuth = 'Basic ' + Buffer.from('user1:grafana-key').toString('base64');
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(expectedAuth);
    expect((opts.headers as Record<string, string>)['Content-Type']).toContain('text/plain');
    expect(typeof opts.body).toBe('string');
    expect(opts.body as string).toContain('routerly_requests_total');
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('grafana down'));
    await expect(pushGrafana(integration, snapshot)).rejects.toThrow('grafana down');
  });

  it('includes token, cost, duration and budget lines when maps/projects are non-empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockBudgetRatio.mockResolvedValue(0.5);

    const richSnapshot = {
      agg: {
        requests: new Map([['r', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 2 }]]),
        tokens: new Map([['t', { labels: { project: 'P', model: 'M', provider: 'openai', type: 'input' }, value: 100 }]]),
        cost: new Map([['c', { labels: { project: 'P', model: 'M', provider: 'openai' }, value: 0.005 }]]),
        durations: new Map([['d', { labels: { project: 'P', model: 'M' }, latencies: [10, 20, 30, 40, 50] }]]),
      },
      projectName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
      projects: [{ id: 'proj1', name: 'Project One', models: [] } as unknown as import('@routerly/shared').ProjectConfig],
      models: [],
    };

    await pushGrafana(integration, richSnapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.body as string).toContain('routerly_tokens_total');
    expect(opts.body as string).toContain('routerly_cost_usd_total');
    expect(opts.body as string).toContain('routerly_request_duration_p50_ms');
    expect(opts.body as string).toContain('routerly_budget_used_ratio');
  });
});
