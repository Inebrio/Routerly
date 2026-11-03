import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch, mockReadConfig } = vi.hoisted(() => ({ mockFetch: vi.fn(), mockReadConfig: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);
vi.mock('../config/loader.js', () => ({ readConfig: mockReadConfig }));

import { ServiceContainer, EventBus } from '../../core/index.js';
import { OBSERVABILITY } from '../../core/tokens.js';
import { observabilityModule } from './index.js';
import { resetTraceExportCache } from './traces-export.js';
import { TRACE_COMPLETED_TOPIC } from '../trace/publish.js';

beforeEach(() => {
  vi.clearAllMocks();
  resetTraceExportCache();
  mockFetch.mockResolvedValue({ ok: true });
});

describe('observability module', () => {
  it('registers the OBSERVABILITY surface', async () => {
    const container = new ServiceContainer();
    await observabilityModule.register({ container, events: new EventBus() });
    const obs = container.resolve(OBSERVABILITY);
    expect(typeof obs.getMetricsSnapshot).toBe('function');
    expect(typeof obs.startIntegrationRunner).toBe('function');
  });

  it('ships a finished trace to the integrations that asked for it', async () => {
    mockReadConfig.mockResolvedValue({
      integrations: [{ id: 'w1', type: 'webhook', enabled: true, url: 'http://hook.local', traces: { enabled: true } }],
    });
    const container = new ServiceContainer();
    const events = new EventBus();
    await observabilityModule.register({ container, events });

    events.publish(TRACE_COMPLETED_TOPIC, {
      traceId: 't1',
      entries: [{ panel: 'response', message: 'model:success', details: {}, at: 1, phase: 'routing.execute' }],
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    expect(mockFetch.mock.calls[0]![0]).toBe('http://hook.local');
  });

  it('runs the metric push for as long as the module does', async () => {
    vi.useFakeTimers();
    mockReadConfig.mockResolvedValue({ integrations: [] });
    try {
      await observabilityModule.start!({} as never);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockReadConfig).toHaveBeenCalledTimes(1);

      await observabilityModule.stop!();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(mockReadConfig).toHaveBeenCalledTimes(1);
    } finally {
      await observabilityModule.stop!();
      vi.useRealTimers();
    }
  });
});
