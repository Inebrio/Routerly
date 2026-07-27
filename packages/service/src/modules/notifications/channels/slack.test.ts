import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSlack } from './slack.js';
import type { SlackChannelConfig } from '@routerly/shared';

const cfg: SlackChannelConfig = {
  id: 'ch1',
  provider: 'slack',
  botToken: 'xoxb-test-token',
  channelId: 'C12345',
};

const payload = {
  event:     'budget_exceeded',
  severity:  'critical' as const,
  timestamp: '2024-01-01T00:00:00.000Z',
  details:   { project: 'my-project' },
};

afterEach(() => vi.clearAllMocks());

describe('sendSlack', () => {
  it('POSTs to chat.postMessage with correct headers and body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendSlack(cfg, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer xoxb-test-token');
    const body = JSON.parse(init.body as string);
    expect(body.channel).toBe('C12345');
    expect(body.blocks[0].type).toBe('header');
  });

  it('throws on non-200 HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate_limited',
    }));

    await expect(sendSlack(cfg, payload)).rejects.toThrow('Slack HTTP 429');
  });

  it('throws when Slack returns ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    }));

    await expect(sendSlack(cfg, payload)).rejects.toThrow('channel_not_found');
  });

  it('throws unknown when Slack ok:false has no error field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    }));

    await expect(sendSlack(cfg, payload)).rejects.toThrow('unknown');
  });

  it('falls back to :bell: emoji for unknown severity', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendSlack(cfg, { ...payload, severity: 'unknown' as any });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.blocks[0].text.text).toContain(':bell:');
  });

  it('includes detail fields when details present', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendSlack(cfg, { ...payload, details: { foo: 'bar' } });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    const fields = body.blocks[1].fields as { text: string }[];
    expect(fields.some((f) => f.text.includes('foo'))).toBe(true);
  });

  it('sends only Time field when details is undefined (line 29 cond-expr branch=1)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // No details field → payload.details is undefined → spread is empty → only Time field
    await sendSlack(cfg, { ...payload, details: undefined as any });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    const fields = body.blocks[1].fields as { text: string }[];
    // Only the Time field should be present
    expect(fields).toHaveLength(1);
    expect(fields[0]!.text).toContain('Time:');
  });
});
