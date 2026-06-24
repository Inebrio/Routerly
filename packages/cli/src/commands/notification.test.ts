import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeNotificationCommand } from './notification.js';

vi.mock('../api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

import { api, ApiError } from '../api.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

// ── Inbox commands ────────────────────────────────────────────────────────────

describe('notification list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table when notifications returned as array', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'n1', severity: 'info', event: 'model.added', timestamp: '2024-01-01T00:00:00Z', details: 'gpt-4o added' },
    ]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/notifications/inbox?limit=50');
    expect(console.log).toHaveBeenCalled();
  });

  it('prints table when notifications returned as object', async () => {
    mockApi.mockResolvedValueOnce({
      notifications: [
        { id: 'n2', severity: 'warning', event: 'budget.threshold', timestamp: '2024-01-01T00:00:00Z' },
      ],
    });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(console.log).toHaveBeenCalled();
  });

  it('prints message when no notifications', async () => {
    mockApi.mockResolvedValueOnce([]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No notifications'));
  });

  it('outputs JSON with --json flag', async () => {
    const data = [{ id: 'n1', severity: 'info', event: 'test', timestamp: '2024-01-01T00:00:00Z' }];
    mockApi.mockResolvedValueOnce(data);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'list', '--json']);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('Network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('notification read', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('marks all as read when no id given', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'read']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/inbox/read', { all: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('all notifications'));
  });

  it('marks specific notification as read', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'read', 'n1']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/inbox/read', { ids: ['n1'] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"n1"'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'read'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── Channel sub-commands ──────────────────────────────────────────────────────

async function runChannel(...args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy  = vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.map(String).join(' ')); });
  const errSpy  = vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.map(String).join(' ')); });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);

  try {
    const cmd = makeNotificationCommand();
    cmd.exitOverride();
    await cmd.parseAsync(['node', 'notification', 'channel', ...args]);
  } catch {
    // swallow commander exits and process.exit throws
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { out, err };
}

describe('notification channel list', () => {
  it('prints a table of channels', async () => {
    mockApi.mockResolvedValue([
      { id: 'ch1', provider: 'slack', name: 'ops-alerts', botToken: 'x', channelId: 'C123' },
    ]);
    const { out } = await runChannel('list');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/notifications/channels');
    expect(out.length).toBeGreaterThan(0);
  });

  it('prints empty message when no channels', async () => {
    mockApi.mockResolvedValue([]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('No notification channels');
  });
});

describe('notification channel add', () => {
  it('adds a slack channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'slack', name: 'ops' });
    const { out } = await runChannel('add', '--type', 'slack', '--name', 'ops', '--bot-token', 'xoxb-abc', '--channel-id', 'C123');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'slack' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a teams channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch2', provider: 'teams', name: 'devs' });
    const { out } = await runChannel('add', '--type', 'teams', '--name', 'devs', '--webhook-url', 'https://outlook.office.com/webhook/x');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'teams' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a pagerduty channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch3', provider: 'pagerduty', name: 'oncall' });
    const { out } = await runChannel('add', '--type', 'pagerduty', '--name', 'oncall', '--integration-key', 'key123');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'pagerduty' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a discord channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch4', provider: 'discord', name: 'dev-alerts' });
    const { out } = await runChannel('add', '--type', 'discord', '--name', 'dev-alerts', '--webhook-url', 'https://discord.com/api/webhooks/x');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'discord' }));
    expect(out.join(' ')).toContain('added');
  });
});

describe('notification channel delete', () => {
  it('deletes a channel by id', async () => {
    mockApi.mockResolvedValue(undefined);
    const { out } = await runChannel('delete', 'ch1');
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/notifications/channels/ch1');
    expect(out.join(' ')).toContain('deleted');
  });

  it('prints not found on 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'not found'));
    const { err } = await runChannel('delete', 'missing-id');
    expect(err.join(' ')).toContain('not found');
  });
});

describe('notification channel test', () => {
  it('prints success message on ok:true', async () => {
    mockApi.mockResolvedValue({ ok: true, message: 'Test message sent via Slack.' });
    const { out } = await runChannel('test', 'ch1');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels/ch1/test', {});
    expect(out.join(' ')).toContain('Test message sent');
  });

  it('prints failure message on ok:false', async () => {
    mockApi.mockResolvedValue({ ok: false, message: 'channel_not_found' });
    const { err } = await runChannel('test', 'ch1');
    expect(err.join(' ')).toContain('channel_not_found');
  });
});
