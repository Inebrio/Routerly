import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendTeams } from './teams.js';
import type { TeamsChannelConfig } from '@routerly/shared';

const cfg: TeamsChannelConfig = {
  id: 'ch2',
  provider: 'teams',
  webhookUrl: 'https://outlook.office.com/webhook/test',
};

const payload = {
  event:     'model_error',
  severity:  'warning' as const,
  timestamp: '2024-01-01T00:00:00.000Z',
};

afterEach(() => vi.clearAllMocks());

describe('sendTeams', () => {
  it('POSTs an Adaptive Card to the webhookUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendTeams(cfg, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://outlook.office.com/webhook/test');
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe('message');
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  it('throws on non-200 HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    }));

    await expect(sendTeams(cfg, payload)).rejects.toThrow('Teams HTTP 400');
  });
});
