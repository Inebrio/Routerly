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
});
