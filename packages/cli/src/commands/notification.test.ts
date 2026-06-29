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
      items: [
        { id: 'n2', severity: 'warning', event: 'budget.threshold', timestamp: '2024-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      enabled: true,
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

  it('passes --from and --to as query params', async () => {
    mockApi.mockResolvedValueOnce([]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'list', '--from', '2026-01-01', '--to', '2026-02-01']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/notifications/inbox?limit=50&from=2026-01-01&to=2026-02-01');
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('Network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('notification delete', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('deletes specific ids', async () => {
    mockApi.mockResolvedValueOnce({ deleted: 2 });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'delete', 'n1', 'n2']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/inbox/delete', { ids: ['n1', 'n2'] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Deleted 2 notifications'));
  });

  it('deletes all with --all', async () => {
    mockApi.mockResolvedValueOnce({ deleted: 5 });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'delete', '--all']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/inbox/delete', { all: true });
  });

  it('uses singular wording for one deletion', async () => {
    mockApi.mockResolvedValueOnce({ deleted: 1 });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'delete', 'n1']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Deleted 1 notification.'));
  });

  it('outputs JSON with --json', async () => {
    mockApi.mockResolvedValueOnce({ deleted: 3 });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'delete', '--all', '--json']);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ deleted: 3 }, null, 2));
  });

  it('errors when no ids and no --all', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'delete'])).rejects.toThrow('exit');
    expect(mockApi).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'delete', 'n1'])).rejects.toThrow('exit');
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

describe('notification unread', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('marks all as unread when no id given', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'unread']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/inbox/unread', { all: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('all notifications'));
  });

  it('marks specific notification as unread', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'unread', 'n1']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/inbox/unread', { ids: ['n1'] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"n1"'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'unread'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('notification show', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints the notification detail table', async () => {
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    mockApi.mockResolvedValueOnce({
      id: 'n1', severity: 'warning', event: 'budget.threshold',
      timestamp: '2024-01-01T00:00:00Z', details: { project: 'Acme', used: 95 }, read: false,
    });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'show', 'n1']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/notifications/inbox/n1');
    const out = lines.join('\n');
    expect(out).toContain('budget.threshold');
    expect(out).toContain('project');
    expect(out).toContain('Acme');
    expect(out).toContain('unread');
  });

  it('renders without a details table when details absent', async () => {
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    mockApi.mockResolvedValueOnce({
      id: 'n2', severity: 'info', event: 'model.added', timestamp: '2024-01-01T00:00:00Z', read: true,
    });
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'show', 'n2']);
    const out = lines.join('\n');
    expect(out).toContain('model.added');
    expect(out).toContain('read');
    expect(out).not.toContain('Details:');
  });

  it('outputs JSON with --json flag', async () => {
    const data = { id: 'n1', severity: 'info', event: 'x', timestamp: '2024-01-01T00:00:00Z', read: false };
    mockApi.mockResolvedValueOnce(data);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'routerly', 'show', 'n1', '--json']);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it('prints not found on 404', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Notification not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'show', 'missing'])).rejects.toThrow('exit');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on generic error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeNotificationCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'show', 'n1'])).rejects.toThrow('exit');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network error'));
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
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels/ch1/test', { to: undefined });
    expect(out.join(' ')).toContain('Test message sent');
  });

  it('forwards --to recipient in the request body', async () => {
    mockApi.mockResolvedValue({ ok: true, message: 'Sent' });
    await runChannel('test', 'ch1', '--to', 'me@example.com');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels/ch1/test', { to: 'me@example.com' });
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
  it('renders critical severity in red', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApi.mockResolvedValueOnce([
      { id: 'n1', severity: 'critical', event: 'provider.error', timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'notification', 'list']);
    expect(lines.join(' ')).toContain('provider.error');
  });

  it('renders details longer than 60 chars truncated', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // serialized details > 60 chars → sliced to 57 + '…'
    const details = { message: 'x'.repeat(80) };
    mockApi.mockResolvedValueOnce([
      { id: 'n1', severity: 'warning', event: 'x', timestamp: '2024-01-01T00:00:00Z', details },
    ]);
    const cmd = makeNotificationCommand();
    await cmd.parseAsync(['node', 'notification', 'list']);
    // The table string contains the truncated marker
    const output = lines.join('\n');
    expect(output).toContain('…');
    expect(output).toContain(JSON.stringify(details).slice(0, 57));
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

describe('notification channel show', () => {
  it('prints channel detail with events, targets and masked secrets', async () => {
    mockApi.mockResolvedValue({
      id: 'ch1', provider: 'slack', name: 'ops',
      events: ['budget.*'], targets: { roles: ['admin'] },
      channelId: 'C123', botToken: 'xoxb-secret',
    });
    const { out } = await runChannel('show', 'ch1');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/notifications/channels/ch1');
    const s = out.join(' ');
    expect(s).toContain('ops');
    expect(s).toContain('slack');
    expect(s).toContain('budget.*');
    expect(s).toContain('admin');
    expect(s).toContain('channelId');
    expect(s).toContain('configured'); // botToken masked
  });

  it('shows "events: all" and "(unnamed)" when absent', async () => {
    mockApi.mockResolvedValue({ id: 'ch2', provider: 'webhook', url: 'https://x.com' });
    const { out } = await runChannel('show', 'ch2');
    const s = out.join(' ');
    expect(s).toContain('(unnamed)');
    expect(s).toContain('events: all');
  });

  it('marks an unset secret as "(not set)"', async () => {
    mockApi.mockResolvedValue({ id: 'ch3', provider: 'slack', name: 's', botToken: '' });
    const { out } = await runChannel('show', 'ch3');
    expect(out.join(' ')).toContain('not set');
  });

  it('outputs JSON with --json flag', async () => {
    const data = { id: 'ch1', provider: 'slack', name: 'ops' };
    mockApi.mockResolvedValue(data);
    const { out } = await runChannel('show', 'ch1', '--json');
    expect(out.join('')).toContain('"provider"');
  });

  it('prints not found on 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'not found'));
    const { err } = await runChannel('show', 'missing');
    expect(err.join(' ')).toContain('not found');
  });

  it('prints generic error on non-404 error', async () => {
    mockApi.mockRejectedValue(new Error('boom'));
    const { err } = await runChannel('show', 'ch1');
    expect(err.join(' ')).toContain('boom');
  });

  it('renders a provider with no secret fields and a null-valued field', async () => {
    mockApi.mockResolvedValue({ id: 'd1', provider: 'dashboard', name: 'inbox', note: null });
    const { out } = await runChannel('show', 'd1');
    expect(out.join(' ')).toContain('note');
  });
});

describe('notification channel edit', () => {
  it('patches name, events, targets', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'dashboard', name: 'new' });
    const { out } = await runChannel(
      'edit', 'ch1', '--name', 'new',
      '--events', 'budget.*,model.added',
      '--target-roles', 'admin', '--target-permissions', 'models:read', '--target-users', 'u1',
    );
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/notifications/channels/ch1', expect.objectContaining({
      name: 'new',
      events: ['budget.*', 'model.added'],
      targets: { roles: ['admin'], permissions: ['models:read'], users: ['u1'] },
    }));
    expect(out.join(' ')).toContain('updated');
  });

  it('patches all non-secret smtp/ses/webhook fields including --port', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'smtp', name: 'mail' });
    await runChannel(
      'edit', 'ch1',
      '--from-address', 'no-reply@x.com', '--from-name', 'Routerly',
      '--host', 'smtp.x.com', '--port', '587',
      '--region', 'eu-west-1', '--access-key-id', 'AKIA',
      '--client-id', 'cid', '--url', 'https://h.com', '--method', 'POST',
      '--channel-id', 'C9',
    );
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/notifications/channels/ch1', expect.objectContaining({
      fromAddress: 'no-reply@x.com', fromName: 'Routerly',
      host: 'smtp.x.com', port: 587,
      region: 'eu-west-1', accessKeyId: 'AKIA',
      clientId: 'cid', url: 'https://h.com', method: 'POST', channelId: 'C9',
    }));
  });

  it('ignores an empty secret value', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'slack', name: 's' });
    await runChannel('edit', 'ch1', '--name', 'x', '--bot-token', '');
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/notifications/channels/ch1', { name: 'x' });
  });

  it('clears events when --events is empty', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'dashboard', name: 'x' });
    await runChannel('edit', 'ch1', '--events', '');
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/notifications/channels/ch1', { events: [] });
  });

  it('includes a provided secret field', async () => {
    mockApi.mockResolvedValue({ id: 'ch1', provider: 'slack', name: 's' });
    await runChannel('edit', 'ch1', '--bot-token', 'xoxb-new');
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/notifications/channels/ch1', { botToken: 'xoxb-new' });
  });

  it('errors when no fields provided', async () => {
    const { err } = await runChannel('edit', 'ch1');
    expect(err.join(' ')).toContain('No fields to update');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('prints not found on 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'not found'));
    const { err } = await runChannel('edit', 'missing', '--name', 'x');
    expect(err.join(' ')).toContain('not found');
  });

  it('prints bad request on 400', async () => {
    mockApi.mockRejectedValue(new ApiError(400, 'invalid port'));
    const { err } = await runChannel('edit', 'ch1', '--name', 'x');
    expect(err.join(' ')).toContain('invalid port');
  });

  it('prints generic error on other failure', async () => {
    mockApi.mockRejectedValue(new Error('server down'));
    const { err } = await runChannel('edit', 'ch1', '--name', 'x');
    expect(err.join(' ')).toContain('server down');
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

  it('renders an unnamed channel with missing provider fields', async () => {
    mockApi.mockResolvedValue([{ id: 's2', provider: 'slack' }]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('(unnamed)');
    expect(out.join(' ')).toContain('channelId=');
  });

  it('renders webhook-based providers with missing url fields', async () => {
    mockApi.mockResolvedValue([
      { id: 't2', provider: 'teams', name: 't' },
      { id: 'd2', provider: 'discord', name: 'd' },
      { id: 'w2', provider: 'webhook', name: 'w' },
    ]);
    const { out } = await runChannel('list');
    expect(out.join(' ')).toContain('url=');
  });
});

// ── Email provider channel add ────────────────────────────────────────────────

describe('notification channel add — email providers', () => {
  it('adds an smtp channel with required fields', async () => {
    mockApi.mockResolvedValue({ id: 'e1', provider: 'smtp', name: 'mail' });
    const { out } = await runChannel(
      'add', '--type', 'smtp', '--name', 'mail',
      '--from-address', 'no-reply@x.com',
      '--host', 'smtp.x.com', '--port', '587',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'smtp', fromAddress: 'no-reply@x.com', host: 'smtp.x.com', port: 587, secure: false,
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('adds an smtp channel with --secure flag and optional fields', async () => {
    mockApi.mockResolvedValue({ id: 'e2', provider: 'smtp', name: 'mail' });
    await runChannel(
      'add', '--type', 'smtp', '--name', 'mail',
      '--from-address', 'no-reply@x.com', '--from-name', 'Routerly',
      '--host', 'smtp.x.com', '--port', '465', '--secure',
      '--username', 'user', '--password', 'pass',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      secure: true, username: 'user', password: 'pass', fromName: 'Routerly',
    }));
  });

  it('adds smtp with default port 587 when --port is omitted', async () => {
    mockApi.mockResolvedValue({ id: 'e3', provider: 'smtp', name: 'mail' });
    await runChannel('add', '--type', 'smtp', '--name', 'mail', '--from-address', 'a@b.com', '--host', 'h');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({ port: 587 }));
  });

  it('errors when smtp is missing --host', async () => {
    const { err } = await runChannel('add', '--type', 'smtp', '--name', 'mail', '--from-address', 'a@b.com');
    expect(err.join(' ')).toContain('--host');
  });

  it('errors when smtp is missing --from-address', async () => {
    const { err } = await runChannel('add', '--type', 'smtp', '--name', 'mail', '--host', 'h');
    expect(err.join(' ')).toContain('--from-address');
  });

  it('adds a ses channel', async () => {
    mockApi.mockResolvedValue({ id: 's1', provider: 'ses', name: 'aws-mail' });
    const { out } = await runChannel(
      'add', '--type', 'ses', '--name', 'aws-mail',
      '--from-address', 'no-reply@x.com', '--region', 'us-east-1',
      '--access-key-id', 'AKIA', '--secret-access-key', 'secret',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'ses', region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'secret',
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('errors when ses is missing --region', async () => {
    const { err } = await runChannel('add', '--type', 'ses', '--name', 'x', '--from-address', 'a@b.com');
    expect(err.join(' ')).toContain('--region');
  });

  it('adds a sendgrid channel', async () => {
    mockApi.mockResolvedValue({ id: 'sg1', provider: 'sendgrid', name: 'sg' });
    const { out } = await runChannel(
      'add', '--type', 'sendgrid', '--name', 'sg',
      '--from-address', 'no-reply@x.com', '--api-key', 'SG.test',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'sendgrid', apiKey: 'SG.test',
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('errors when sendgrid is missing --api-key', async () => {
    const { err } = await runChannel('add', '--type', 'sendgrid', '--name', 'x', '--from-address', 'a@b.com');
    expect(err.join(' ')).toContain('--api-key');
  });

  it('adds an azure channel', async () => {
    mockApi.mockResolvedValue({ id: 'az1', provider: 'azure', name: 'az' });
    const { out } = await runChannel(
      'add', '--type', 'azure', '--name', 'az',
      '--from-address', 'no-reply@x.com',
      '--connection-string', 'endpoint=https://x.communication.azure.com;accesskey=abc',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'azure', connectionString: 'endpoint=https://x.communication.azure.com;accesskey=abc',
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('errors when azure is missing --connection-string', async () => {
    const { err } = await runChannel('add', '--type', 'azure', '--name', 'x', '--from-address', 'a@b.com');
    expect(err.join(' ')).toContain('--connection-string');
  });

  it('adds a google channel', async () => {
    mockApi.mockResolvedValue({ id: 'g1', provider: 'google', name: 'gmail' });
    const { out } = await runChannel(
      'add', '--type', 'google', '--name', 'gmail',
      '--from-address', 'no-reply@gmail.com',
      '--client-id', 'cid', '--client-secret', 'csecret', '--refresh-token', 'rtoken',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      provider: 'google', clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken',
    }));
    expect(out.join(' ')).toContain('added');
  });

  it('errors when google is missing --client-id', async () => {
    const { err } = await runChannel(
      'add', '--type', 'google', '--name', 'x', '--from-address', 'a@b.com',
      '--client-secret', 'cs', '--refresh-token', 'rt',
    );
    expect(err.join(' ')).toContain('--client-id');
  });

  it('errors when google is missing --client-secret', async () => {
    const { err } = await runChannel(
      'add', '--type', 'google', '--name', 'x', '--from-address', 'a@b.com',
      '--client-id', 'ci', '--refresh-token', 'rt',
    );
    expect(err.join(' ')).toContain('--client-id');
  });

  it('errors when google is missing --refresh-token', async () => {
    const { err } = await runChannel(
      'add', '--type', 'google', '--name', 'x', '--from-address', 'a@b.com',
      '--client-id', 'ci', '--client-secret', 'cs',
    );
    expect(err.join(' ')).toContain('--client-id');
  });

  it('adds smtp with events and targets', async () => {
    mockApi.mockResolvedValue({ id: 'e4', provider: 'smtp', name: 'mail' });
    await runChannel(
      'add', '--type', 'smtp', '--name', 'mail',
      '--from-address', 'a@b.com', '--host', 'h',
      '--events', 'budget.*', '--target-roles', 'admin',
    );
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/notifications/channels', expect.objectContaining({
      events: ['budget.*'], targets: { roles: ['admin'] },
    }));
  });

  it('prints unknown type error for unknown email-looking type', async () => {
    const { err } = await runChannel('add', '--type', 'mailgun', '--name', 'x', '--from-address', 'a@b.com');
    expect(err.join(' ')).toContain('Unknown type');
    expect(err.join(' ')).toContain('mailgun');
  });
});

