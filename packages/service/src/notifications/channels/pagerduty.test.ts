import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendPagerDuty } from './pagerduty.js';
import type { PagerDutyChannelConfig } from '@routerly/shared';

const cfg: PagerDutyChannelConfig = {
  id: 'ch3',
  provider: 'pagerduty',
  integrationKey: 'test-integration-key-32chars',
};

const payload = {
  event:     'budget_exceeded',
  severity:  'critical' as const,
  timestamp: '2024-01-01T00:00:00.000Z',
  details:   { threshold: '$100' },
};

afterEach(() => vi.clearAllMocks());

describe('sendPagerDuty', () => {
  it('POSTs a trigger event to PagerDuty v2 endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendPagerDuty(cfg, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://events.pagerduty.com/v2/enqueue');
    const body = JSON.parse(init.body as string);
    expect(body.routing_key).toBe('test-integration-key-32chars');
    expect(body.event_action).toBe('trigger');
    expect(body.payload.severity).toBe('critical');
  });

  it('maps warning severity correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendPagerDuty(cfg, { ...payload, severity: 'warning' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.payload.severity).toBe('warning');
  });

  it('maps info severity correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendPagerDuty(cfg, { ...payload, severity: 'info' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.payload.severity).toBe('info');
  });

  it('throws on non-200 HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    }));

    await expect(sendPagerDuty(cfg, payload)).rejects.toThrow('PagerDuty HTTP 403');
  });
});
