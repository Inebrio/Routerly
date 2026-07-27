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

  it('falls back to default color for unknown severity', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendTeams(cfg, { ...payload, severity: 'unknown' as any });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.attachments[0].content.body[0].color).toBe('default');
  });

  it('includes FactSet when details are provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendTeams(cfg, { ...payload, details: { model: 'gpt-4o', count: 5 } });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    const bodyBlocks = body.attachments[0].content.body as { type: string }[];
    expect(bodyBlocks.some((b) => b.type === 'FactSet')).toBe(true);
  });

  it('omits FactSet when no details', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendTeams(cfg, { event: 'test', severity: 'info', timestamp: '2024-01-01T00:00:00Z' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    const bodyBlocks = body.attachments[0].content.body as { type: string }[];
    expect(bodyBlocks.some((b) => b.type === 'FactSet')).toBe(false);
  });
});
