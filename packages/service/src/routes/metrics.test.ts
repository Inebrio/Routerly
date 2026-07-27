import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../modules/config/loader.js', () => ({ readConfig: vi.fn() }));
vi.mock('../modules/budget/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }));

import { metricsRoutes } from './metrics.js';
import { readConfig } from '../modules/config/loader.js';
import { getLimitUsageSnapshot } from '../modules/budget/budget.js';

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>);
const mockSnapshot = vi.mocked(getLimitUsageSnapshot as (...args: any[]) => Promise<any>);

afterEach(() => vi.clearAllMocks());

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(metricsRoutes);
  await app.ready();
  return app;
}

const models = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', endpoint: '', cost: { inputPerMillion: 1, outputPerMillion: 1 } },
  { id: 'claude', name: 'Claude', provider: 'anthropic', endpoint: '', cost: { inputPerMillion: 1, outputPerMillion: 1 } },
];

const projects = [
  { id: 'p1', name: 'proj1', tokens: [], members: [], models: [{ modelId: 'gpt-4o' }] },
];

function setup(config: Record<string, any>): void {
  mockReadConfig.mockImplementation(async (key: string) => config[key] ?? []);
}

describe('GET /metrics', () => {
  it('returns Prometheus text format with all metric families', async () => {
    setup({
      settings: {},
      models,
      projects,
      usage: [
        { id: '1', timestamp: '2026-01-01T00:00:00Z', projectId: 'p1', modelId: 'gpt-4o', inputTokens: 100, outputTokens: 50, cachedInputTokens: 10, cost: 0.001, latencyMs: 200, outcome: 'success' },
        { id: '2', timestamp: '2026-01-01T00:01:00Z', projectId: 'p1', modelId: 'gpt-4o', inputTokens: 200, outputTokens: 60, cost: 0.002, latencyMs: 400, outcome: 'success' },
        { id: '3', timestamp: '2026-01-01T00:02:00Z', projectId: 'p1', modelId: 'gpt-4o', inputTokens: 10, outputTokens: 5, cost: 0.0001, latencyMs: 100, outcome: 'error' },
      ],
    });
    mockSnapshot.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 2.5, remaining: 7.5 }]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const body = res.body;

    // counters
    expect(body).toContain('# TYPE routerly_requests_total counter');
    expect(body).toContain('routerly_requests_total{project="proj1",model="gpt-4o",provider="openai",status="success"} 2');
    expect(body).toContain('routerly_requests_total{project="proj1",model="gpt-4o",provider="openai",status="error"} 1');

    // tokens: input 100+200+10=310, output 50+60+5=115, cached 10
    expect(body).toContain('routerly_tokens_total{project="proj1",model="gpt-4o",type="input"} 310');
    expect(body).toContain('routerly_tokens_total{project="proj1",model="gpt-4o",type="output"} 115');
    expect(body).toContain('routerly_tokens_total{project="proj1",model="gpt-4o",type="cached"} 10');

    // cost: 0.0031
    expect(body).toContain('routerly_cost_usd_total{project="proj1",model="gpt-4o"} 0.0031');

    // duration gauges present
    expect(body).toContain('# TYPE routerly_request_duration_p50_ms gauge');
    expect(body).toContain('routerly_request_duration_p50_ms{project="proj1",model="gpt-4o"}');
    expect(body).toContain('routerly_request_duration_p95_ms{project="proj1",model="gpt-4o"}');

    // budget ratio: 2.5 / 10 = 0.25
    expect(body).toContain('routerly_budget_used_ratio{project="proj1"} 0.25');
  });

  it('returns 404 when metricsEnabled is false', async () => {
    setup({ settings: { metricsEnabled: false }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('serves when metricsEnabled is undefined (default true)', async () => {
    setup({ settings: {}, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it('reports unknown provider for unmapped models and falls back to projectId for unknown projects', async () => {
    setup({
      settings: {},
      models: [],
      projects: [],
      usage: [
        { id: '1', timestamp: '2026-01-01T00:00:00Z', projectId: 'ghost', modelId: 'mystery', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 10, outcome: 'success' },
      ],
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.body).toContain('provider="unknown"');
    expect(res.body).toContain('project="ghost"');
  });

  it('escapes special characters in label values', async () => {
    setup({
      settings: {},
      models: [{ id: 'm"q', name: 'x', provider: 'custom', endpoint: '', cost: { inputPerMillion: 0, outputPerMillion: 0 } }],
      projects: [{ id: 'pq', name: 'proj"two', tokens: [], members: [], models: [] }],
      usage: [
        { id: '1', timestamp: '2026-01-01T00:00:00Z', projectId: 'pq', modelId: 'm"q', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 10, outcome: 'success' },
      ],
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.body).toContain('project="proj\\"two"');
    expect(res.body).toContain('model="m\\"q"');
  });

  it('computes percentiles from the latency distribution', async () => {
    const usage = Array.from({ length: 10 }, (_v, i) => ({
      id: String(i), timestamp: `2026-01-01T00:0${i}:00Z`, projectId: 'p1', modelId: 'gpt-4o',
      inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: (i + 1) * 100, outcome: 'success',
    }));
    setup({ settings: {}, models, projects, usage });
    mockSnapshot.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    // latencies 100..1000; p50 -> index ceil(0.5*10)-1=4 -> 500; p95 -> ceil(0.95*10)-1=9 -> 1000
    expect(res.body).toContain('routerly_request_duration_p50_ms{project="proj1",model="gpt-4o"} 500');
    expect(res.body).toContain('routerly_request_duration_p95_ms{project="proj1",model="gpt-4o"} 1000');
  });

  it('reports 0 budget ratio when no cost limits are configured', async () => {
    setup({ settings: {}, models, projects, usage: [] });
    mockSnapshot.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.body).toContain('routerly_budget_used_ratio{project="proj1"} 0');
  });

  it('returns 401 when prometheusAuthToken is set and request has no token', async () => {
    setup({ settings: { prometheusAuthToken: 'secret' }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 when correct Bearer token is provided', async () => {
    setup({ settings: { prometheusAuthToken: 'secret' }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer secret' } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('integration: enabled, no auth → 200', async () => {
    setup({ settings: { integrations: [{ id: 'i1', type: 'prometheus', enabled: true }] }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it('integration: disabled → 404', async () => {
    setup({ settings: { integrations: [{ id: 'i1', type: 'prometheus', enabled: false }] }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('integration: authToken, no header → 401', async () => {
    setup({ settings: { integrations: [{ id: 'i1', type: 'prometheus', enabled: true, authToken: 'tok' }] }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('integration: authToken, correct header → 200', async () => {
    setup({ settings: { integrations: [{ id: 'i1', type: 'prometheus', enabled: true, authToken: 'tok' }] }, models: [], projects: [], usage: [] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer tok' } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});
