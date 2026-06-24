import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));

vi.mock('../api.js', () => ({
  api: mockApi,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

vi.mock('../store.js', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test', serverUrl: 'http://localhost:3000',
    email: 'test@example.com', token: 'jwt-test', expiresAt: Date.now() + 3_600_000,
  }),
}));

import { makeNotificationCommand } from './notification.js';
import { ApiError } from '../api.js';

afterEach(() => vi.clearAllMocks());

async function run(...args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy  = vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.map(String).join(' ')); });
  const errSpy  = vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.map(String).join(' ')); });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);

  try {
    const cmd = makeNotificationCommand();
    cmd.exitOverride();
    await cmd.parseAsync(['node', 'notification', ...args]);
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
    const { out } = await run('channel', 'list');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/notifications/channels');
    // console.table outputs something to log
    expect(out.length).toBeGreaterThan(0);
  });

  it('prints empty message when no channels', async () => {
    mockApi.mockResolvedValue([]);
    const { out } = await run('channel', 'list');
    expect(out.join(' ')).toContain('No notification channels');
  });
});

describe('notification channel add', () => {
  it('adds a slack channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'slack', name: 'ops' });
    const { out } = await run('channel', 'add', '--type', 'slack', '--name', 'ops', '--bot-token', 'xoxb-abc', '--channel-id', 'C123');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'slack', botToken: 'xoxb-abc', channelId: 'C123' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a teams channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch2', provider: 'teams', name: 'devs' });
    const { out } = await run('channel', 'add', '--type', 'teams', '--name', 'devs', '--webhook-url', 'https://outlook.office.com/webhook/x');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'teams' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a pagerduty channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch3', provider: 'pagerduty', name: 'oncall' });
    const { out } = await run('channel', 'add', '--type', 'pagerduty', '--name', 'oncall', '--integration-key', 'key123');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'pagerduty', integrationKey: 'key123' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a discord channel', async () => {
    mockApi.mockResolvedValue({ id: 'ch4', provider: 'discord', name: 'dev-alerts' });
    const { out } = await run('channel', 'add', '--type', 'discord', '--name', 'dev-alerts', '--webhook-url', 'https://discord.com/api/webhooks/x');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'discord' }));
    expect(out.join(' ')).toContain('added');
  });
});

describe('notification channel delete', () => {
  it('deletes a channel by id', async () => {
    mockApi.mockResolvedValue(undefined);
    const { out } = await run('channel', 'delete', 'ch1');
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/notifications/channels/ch1');
    expect(out.join(' ')).toContain('deleted');
  });

  it('prints not found on 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'not found'));
    const { err } = await run('channel', 'delete', 'missing-id');
    expect(err.join(' ')).toContain('not found');
  });
});

describe('notification channel test', () => {
  it('prints success message on ok:true', async () => {
    mockApi.mockResolvedValue({ ok: true, message: 'Test message sent via Slack.' });
    const { out } = await run('channel', 'test', 'ch1');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels/ch1/test', {});
    expect(out.join(' ')).toContain('Test message sent');
  });

  it('prints failure message and exits 1 on ok:false', async () => {
    mockApi.mockResolvedValue({ ok: false, message: 'channel_not_found' });
    const { err } = await run('channel', 'test', 'ch1');
    expect(err.join(' ')).toContain('channel_not_found');
  });
});
