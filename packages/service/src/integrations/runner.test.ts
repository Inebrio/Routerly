import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ──────────────────────────────────────────────────────────────

const { mockReadConfig, mockSnapshot, mockOtel, mockDatadog, mockGrafana, mockInfluxDB, mockWebhook } =
  vi.hoisted(() => ({
    mockReadConfig: vi.fn(),
    mockSnapshot: vi.fn(),
    mockOtel: vi.fn(),
    mockDatadog: vi.fn(),
    mockGrafana: vi.fn(),
    mockInfluxDB: vi.fn(),
    mockWebhook: vi.fn(),
  }));

vi.mock('../config/loader.js', () => ({ readConfig: mockReadConfig }));
vi.mock('./metrics-snapshot.js', () => ({ getMetricsSnapshot: mockSnapshot }));
vi.mock('./otel.js', () => ({ pushOtel: mockOtel }));
vi.mock('./datadog.js', () => ({ pushDatadog: mockDatadog }));
vi.mock('./grafana.js', () => ({ pushGrafana: mockGrafana }));
vi.mock('./influxdb.js', () => ({ pushInfluxDB: mockInfluxDB }));
vi.mock('./webhook.js', () => ({ pushWebhook: mockWebhook }));

import { startIntegrationRunner } from './runner.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SNAPSHOT = { agg: {}, projects: [], models: [] };

function baseIntegration(type: string, overrides: Record<string, unknown> = {}) {
  return { id: '1', type, enabled: true, ...overrides };
}

/** Runs one tick of the interval callback */
async function tick(handle: NodeJS.Timeout) {
  // The callback is the first argument to setInterval — retrieve and call it
  const cb = (handle as unknown as { _onTimeout: () => Promise<void> })._onTimeout;
  await cb();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshot.mockResolvedValue(SNAPSHOT);
});

describe('startIntegrationRunner', () => {
  it('skips when no integrations configured', async () => {
    mockReadConfig.mockResolvedValue({ integrations: [] });
    const h = startIntegrationRunner();
    await tick(h);
    clearInterval(h);
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('skips disabled integrations', async () => {
    mockReadConfig.mockResolvedValue({
      integrations: [baseIntegration('otel', { enabled: false })],
    });
    const h = startIntegrationRunner();
    await tick(h);
    clearInterval(h);
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('skips prometheus (pull-only)', async () => {
    mockReadConfig.mockResolvedValue({
      integrations: [baseIntegration('prometheus')],
    });
    const h = startIntegrationRunner();
    await tick(h);
    clearInterval(h);
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('calls all enabled push exporters', async () => {
    mockReadConfig.mockResolvedValue({
      integrations: [
        baseIntegration('otel'),
        baseIntegration('datadog'),
        baseIntegration('grafana'),
        baseIntegration('influxdb'),
        baseIntegration('webhook'),
      ],
    });
    mockOtel.mockResolvedValue(undefined);
    mockDatadog.mockResolvedValue(undefined);
    mockGrafana.mockResolvedValue(undefined);
    mockInfluxDB.mockResolvedValue(undefined);
    mockWebhook.mockResolvedValue(undefined);

    const h = startIntegrationRunner();
    await tick(h);
    clearInterval(h);

    expect(mockOtel).toHaveBeenCalledOnce();
    expect(mockDatadog).toHaveBeenCalledOnce();
    expect(mockGrafana).toHaveBeenCalledOnce();
    expect(mockInfluxDB).toHaveBeenCalledOnce();
    expect(mockWebhook).toHaveBeenCalledOnce();
  });

  it('catches per-exporter errors silently (Promise.allSettled)', async () => {
    mockReadConfig.mockResolvedValue({
      integrations: [baseIntegration('otel'), baseIntegration('webhook')],
    });
    mockOtel.mockRejectedValue(new Error('otel down'));
    mockWebhook.mockResolvedValue(undefined);

    const h = startIntegrationRunner();
    await expect(tick(h)).resolves.not.toThrow();
    clearInterval(h);
    expect(mockWebhook).toHaveBeenCalledOnce();
  });

  it('catches readConfig errors silently', async () => {
    mockReadConfig.mockRejectedValue(new Error('disk error'));
    const h = startIntegrationRunner();
    await expect(tick(h)).resolves.not.toThrow();
    clearInterval(h);
  });
});
