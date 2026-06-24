import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeNotificationCommand } from './notification.js';

vi.mock('../api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { api } from '../api.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

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
