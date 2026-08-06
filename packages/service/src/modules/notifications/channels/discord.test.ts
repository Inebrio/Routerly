import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendDiscord } from './discord.js';
import type { DiscordChannelConfig } from '@routerly/shared';

const cfg: DiscordChannelConfig = {
  id: 'ch4',
  provider: 'discord',
  webhookUrl: 'https://discord.com/api/webhooks/123/abc',
};

const payload = {
  event:     'service_down',
  severity:  'critical' as const,
  timestamp: '2024-01-01T00:00:00.000Z',
  details:   { model: 'gpt-4o' },
};

afterEach(() => vi.clearAllMocks());

describe('sendDiscord', () => {
  it('POSTs an embed to the webhookUrl with correct critical color', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendDiscord(cfg, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/123/abc');
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].color).toBe(0xED4245);
    expect(body.embeds[0].title).toContain('CRITICAL');
  });

  it('uses warning color 0xFEE75C for warning severity', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendDiscord(cfg, { ...payload, severity: 'warning' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].color).toBe(0xFEE75C);
  });

  it('uses info color 0x5865F2 for info severity', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendDiscord(cfg, { ...payload, severity: 'info' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].color).toBe(0x5865F2);
  });

  it('throws on non-200 HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));

    await expect(sendDiscord(cfg, payload)).rejects.toThrow('Discord HTTP 401');
  });

  it('falls back to default color for unknown severity', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendDiscord(cfg, { ...payload, severity: 'unknown' as any });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].color).toBe(0x5865F2); // default fallback
  });

  it('includes fields when details are provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendDiscord(cfg, { ...payload, details: { model: 'gpt-4o', router: 'test' } });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].fields).toHaveLength(2);
  });

  it('omits fields when no details', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendDiscord(cfg, { event: 'test', severity: 'info', timestamp: '2024-01-01T00:00:00Z' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].fields).toBeUndefined();
  });
});
