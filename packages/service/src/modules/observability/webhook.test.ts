import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);

import { pushWebhook } from './webhook.js';

const integration = {
  id: '1',
  type: 'webhook' as const,
  enabled: true,
  url: 'http://hook.local/receive',
  secret: 'mysecret',
  headers: { 'X-Env': 'test' },
};

const snapshot = {
  agg: {
    requests: new Map([['k', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 4 }]]),
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

describe('pushWebhook', () => {
  it('POSTs JSON payload with HMAC signature and custom headers', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await pushWebhook(integration, snapshot);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hook.local/receive');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((opts.headers as Record<string, string>)['X-Env']).toBe('test');
    expect((opts.headers as Record<string, string>)['X-Routerly-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const body = JSON.parse(opts.body as string) as { source: string; metrics: { requests: unknown[] } };
    expect(body.source).toBe('routerly');
    expect(body.metrics.requests).toHaveLength(1);
  });

  it('skips signature header when no secret', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { secret: _s, ...noSecret } = integration;

    await pushWebhook(noSecret, snapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['X-Routerly-Signature']).toBeUndefined();
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('hook down'));
    await expect(pushWebhook(integration, snapshot)).rejects.toThrow('hook down');
  });

  it('includes token, cost and duration fields when maps are non-empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const richSnapshot = {
      agg: {
        requests: new Map([['r', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 4 }]]),
        tokens: new Map([['t', { labels: { project: 'P', model: 'M', type: 'input' }, value: 100 }]]),
        cost: new Map([['c', { labels: { project: 'P', model: 'M' }, value: 0.005 }]]),
        durations: new Map([['d', { labels: { project: 'P', model: 'M' }, latencies: [10, 20, 30, 40, 50] }]]),
      },
      projectName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'openai' }),
      projects: [],
      models: [],
    };

    await pushWebhook(integration, richSnapshot);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { metrics: { tokens: unknown[]; cost: unknown[]; latency_p50_ms: unknown[] } };
    expect(body.metrics.tokens).toHaveLength(1);
    expect(body.metrics.cost).toHaveLength(1);
    expect(body.metrics.latency_p50_ms).toHaveLength(1);
  });
});
