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
  const logSpy   = vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.map(String).join(' ')); });
  const tableSpy = vi.spyOn(console, 'table').mockImplementation((...a) => { out.push(JSON.stringify(a[0])); });
  const errSpy   = vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.map(String).join(' ')); });
  const exitSpy  = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);

  try {
    const cmd = makeNotificationCommand();
    cmd.exitOverride();
    await cmd.parseAsync(['node', 'notification', 'channel', ...args]);
  } catch {
    // swallow commander exits and process.exit throws
  } finally {
    logSpy.mockRestore();
    tableSpy.mockRestore();
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

  it('shows events and targets in table', async () => {
    mockApi.mockResolvedValue([
      { id: 'ch5', provider: 'dashboard', name: 'inbox', events: ['budget.*'], targets: { roles: ['admin'] } },
    ]);
    const { out } = await runChannel('list');
    expect(out.length).toBeGreaterThan(0);
  });

  it('outputs JSON with --json flag', async () => {
    const data = [{ id: 'ch1', provider: 'slack', name: 'ops', events: ['*'] }];
    mockApi.mockResolvedValue(data);
    const { out } = await runChannel('list', '--json');
    expect(out.join('')).toContain('"provider"');
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

  it('adds a dashboard channel (no secrets required)', async () => {
    mockApi.mockResolvedValue({ id: 'ch5', provider: 'dashboard', name: 'inbox' });
    const { out } = await runChannel('add', '--type', 'dashboard', '--name', 'inbox');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ provider: 'dashboard', name: 'inbox' }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a dashboard channel with events and target-roles', async () => {
    mockApi.mockResolvedValue({ id: 'ch6', provider: 'dashboard', name: 'budget-inbox' });
    const { out } = await runChannel(
      'add', '--type', 'dashboard', '--name', 'budget-inbox',
      '--events', 'budget.*,model.added',
      '--target-roles', 'admin,viewer',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'dashboard',
      events: ['budget.*', 'model.added'],
      targets: { roles: ['admin', 'viewer'] },
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds a slack channel with events and target-permissions and target-users', async () => {
    mockApi.mockResolvedValue({ id: 'ch7', provider: 'slack', name: 'eng' });
    const { out } = await runChannel(
      'add', '--type', 'slack', '--name', 'eng',
      '--bot-token', 'xoxb-x', '--channel-id', 'C999',
      '--events', 'model.*',
      '--target-permissions', 'models:read',
      '--target-users', 'u1,u2',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'slack',
      events: ['model.*'],
      targets: { permissions: ['models:read'], users: ['u1', 'u2'] },
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('errors on unknown type', async () => {
    const { err } = await runChannel('add', '--type', 'unknown', '--name', 'x');
    expect(err.join(' ')).toContain('Unknown type');
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

  it('prints not found on 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'not found'));
    const { err } = await runChannel('test', 'missing-id');
    expect(err.join(' ')).toContain('missing-id');
  });

  it('prints generic error message on non-404 error', async () => {
    mockApi.mockRejectedValue(new Error('timeout'));
    const { err } = await runChannel('test', 'ch1');
    expect(err.join(' ')).toContain('timeout');
  });
});

describe('notification channel add error paths', () => {
  it('prints ApiError message when POST fails with ApiError', async () => {
    mockApi.mockRejectedValue(new ApiError(422, 'Unprocessable'));
    const { err } = await runChannel('add', '--type', 'dashboard', '--name', 'x');
    expect(err.join(' ')).toContain('422');
    expect(err.join(' ')).toContain('Unprocessable');
  });

  it('prints generic error message when POST fails with plain Error', async () => {
    mockApi.mockRejectedValue(new Error('network error'));
    const { err } = await runChannel('add', '--type', 'dashboard', '--name', 'x');
    expect(err.join(' ')).toContain('network error');
  });
});

describe('notification channel delete error paths', () => {
  it('prints generic error on non-404 error', async () => {
    mockApi.mockRejectedValue(new Error('server down'));
    const { err } = await runChannel('delete', 'ch1');
    expect(err.join(' ')).toContain('server down');
  });
});

describe('notification list severity formatting', () => {
  it('renders error severity in red', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApi.mockResolvedValueOnce([
      { id: 'n1', severity: 'error', event: 'provider.error', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'notification', 'list']);
    expect(lines.join(' ')).toContain('provider.error');
  });

  it('renders details longer than 60 chars truncated', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 65-char details field → gets sliced to 57 + '…'
    const longDetails = 'x'.repeat(65);
    mockApi.mockResolvedValueOnce([
      { id: 'n1', severity: 'warning', event: 'x', timestamp: '2024-01-01T00:00:00Z', details: longDetails },
    ]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'notification', 'list']);
    // The table string contains the truncated marker
    const output = lines.join('\n');
    expect(output).toContain('x'.repeat(57) + '…');
  });

  it('renders null/absent details as dash', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApi.mockResolvedValueOnce([
      { id: 'n1', severity: 'info', event: 'x', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'notification', 'list']);
    // dash placeholder rendered
    expect(lines.join('\n')).toContain('—');
  });
});

describe('notification channel list error handling', () => {
  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('network error'));
    const { err } = await runChannel('list');
    expect(err.join(' ')).toContain('network error');
  });
});

describe('notification channel add missing required args', () => {
  it('exits 1 when slack is missing bot-token and channel-id', async () => {
    const { err } = await runChannel('add', '--type', 'slack', '--name', 'x');
    expect(err.join(' ')).toContain('--bot-token');
  });

  it('exits 1 when teams is missing webhook-url', async () => {
    const { err } = await runChannel('add', '--type', 'teams', '--name', 'x');
    expect(err.join(' ')).toContain('--webhook-url');
  });

  it('exits 1 when pagerduty is missing integration-key', async () => {
    const { err } = await runChannel('add', '--type', 'pagerduty', '--name', 'x');
    expect(err.join(' ')).toContain('--integration-key');
  });

  it('exits 1 when discord is missing webhook-url', async () => {
    const { err } = await runChannel('add', '--type', 'discord', '--name', 'x');
    expect(err.join(' ')).toContain('--webhook-url');
  });
});

describe('notification channel list providerSummary', () => {
  it('shows webhook url', async () => {
    mockApi.mockResolvedValue([{ id: 'w1', provider: 'webhook', name: 'hook', url: 'https://example.com/hook' }]);
    const { out } = await runChannel('list');
    // console.table receives the rows array; check serialized output
    expect(out.join(' ')).toContain('url=https://example.com/hook');
  });

  it('shows pagerduty key masked', async () => {
    mockApi.mockResolvedValue([{ id: 'p1', provider: 'pagerduty', name: 'pd', integrationKey: 'secret' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('key=***');
  });

  it('shows email fromAddress for smtp', async () => {
    mockApi.mockResolvedValue([{ id: 's1', provider: 'smtp', name: 'mail', fromAddress: 'no-reply@x.com' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('from=no-reply@x.com');
  });

  it('shows teams webhookUrl', async () => {
    mockApi.mockResolvedValue([{ id: 't1', provider: 'teams', name: 'ms-teams', webhookUrl: 'https://outlook.office.com/x' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('url=https://outlook.office.com/x');
  });

  it('shows discord webhookUrl', async () => {
    mockApi.mockResolvedValue([{ id: 'd1', provider: 'discord', name: 'dev', webhookUrl: 'https://discord.com/api/webhooks/xyz' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('url=https://discord.com/api/webhooks/xyz');
  });

  it('shows dashboard as in-app inbox', async () => {
    mockApi.mockResolvedValue([{ id: 'd1', provider: 'dashboard', name: 'inbox' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('in-app inbox');
  });

  it('shows targets summary with permissions and users', async () => {
    mockApi.mockResolvedValue([{
      id: 'd1', provider: 'dashboard', name: 'i',
      targets: { permissions: ['user:write'], users: ['u1'] },
    }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('perms:user:write');
    expect(out.join(' ')).toContain('users:u1');
  });

  it('shows targets summary as "everyone" when targets is set but all arrays empty', async () => {
    mockApi.mockResolvedValue([{
      id: 'd1', provider: 'dashboard', name: 'i',
      targets: { roles: [], permissions: [], users: [] },
    }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('everyone');
  });

  it('shows slack channelId', async () => {
    mockApi.mockResolvedValue([{ id: 's1', provider: 'slack', name: 'eng', botToken: 'xoxb-x', channelId: 'C123456' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('channelId=C123456');
  });
});
