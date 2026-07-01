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
    requests: new Map([['k', { labels: { project: 'P', model: 'M', provider: 'openai', status: 'success' }, value: 7 }]]),
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
});
