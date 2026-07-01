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
});
