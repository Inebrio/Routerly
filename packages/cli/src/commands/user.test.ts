import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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
import { makeUserCommand } from './user.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeUserCommand();
  cmd.exitOverride();
  return cmd;
}

const baseUser = { id: 'u1', email: 'alice@example.com', roleId: 'viewer', routerIds: [] };

// ── user list ─────────────────────────────────────────────────────────────────

describe('user list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table with users', async () => {
    mockApi.mockResolvedValueOnce([baseUser]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', 'list']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/users');
    expect(lines.join('\n')).toContain('alice@example.com');
  });

  it('shows "all" for user with empty routerIds', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseUser, routerIds: [] }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', 'list']);
    expect(lines.join('\n')).toContain('all');
  });

  it('shows router ids joined', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseUser, routerIds: ['p1', 'p2'] }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', 'list']);
    expect(lines.join('\n')).toContain('p1, p2');
  });

  it('shows empty state when no users', async () => {
    mockApi.mockResolvedValueOnce([]);
    await makeCmd().parseAsync(['node', 'user', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No users'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'user', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network'));
  });
});

// ── user add ─────────────────────────────────────────────────────────────────

describe('user add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates user with email and password', async () => {
    mockApi.mockResolvedValueOnce(baseUser);
    await makeCmd().parseAsync(['node', 'user', 'add', '--email', 'alice@example.com', '--password', 'secret']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/users', {
      email: 'alice@example.com',
      password: 'secret',
      roleId: 'viewer',
      routerIds: [],
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('created'));
  });

  it('uses role from --role flag', async () => {
    mockApi.mockResolvedValueOnce({ ...baseUser, roleId: 'admin' });
    await makeCmd().parseAsync(['node', 'user', 'add', '--email', 'a@b.com', '--password', 'p', '--role', 'admin']);
    const call = mockApi.mock.calls[0]!;
    expect((call[2] as { roleId: string }).roleId).toBe('admin');
  });

  it('parses --routers into array', async () => {
    mockApi.mockResolvedValueOnce(baseUser);
    await makeCmd().parseAsync(['node', 'user', 'add', '--email', 'a@b.com', '--password', 'p', '--routers', 'p1,p2']);
    const call = mockApi.mock.calls[0]!;
    expect((call[2] as { routerIds: string[] }).routerIds).toEqual(['p1', 'p2']);
  });

  it('reads password from env with --password-stdin', async () => {
    process.env.ROUTERLY_USER_PASSWORD = 'envpass';
    mockApi.mockResolvedValueOnce(baseUser);
    await makeCmd().parseAsync(['node', 'user', 'add', '--email', 'a@b.com', '--password-stdin']);
    const call = mockApi.mock.calls[0]!;
    expect((call[2] as { password: string }).password).toBe('envpass');
    delete process.env.ROUTERLY_USER_PASSWORD;
  });

  it('exits 1 when no password given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'user', 'add', '--email', 'a@b.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--password'));
  });

  it('exits 1 with conflict message on 409', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(409, 'already exists'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', 'add', '--email', 'a@b.com', '--password', 'p'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('exits 1 with generic message on other errors', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', 'add', '--email', 'a@b.com', '--password', 'p'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

// ── user 2fa status ───────────────────────────────────────────────────────────

describe('user 2fa status', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows enabled when totpEnabled is true', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseUser, totpEnabled: true }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', '2fa', 'status', 'alice@example.com']);
    expect(lines.join('\n')).toContain('enabled');
  });

  it('shows disabled when totpEnabled is false', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseUser, totpEnabled: false }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', '2fa', 'status', 'alice@example.com']);
    expect(lines.join('\n')).toContain('disabled');
  });

  it('shows disabled when totpEnabled is absent', async () => {
    mockApi.mockResolvedValueOnce([baseUser]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', '2fa', 'status', 'alice@example.com']);
    expect(lines.join('\n')).toContain('disabled');
  });

  it('exits 1 when user not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', '2fa', 'status', 'missing@x.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', '2fa', 'status', 'alice@example.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── user 2fa reset ────────────────────────────────────────────────────────────

describe('user 2fa reset', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('resets 2FA for existing user', async () => {
    mockApi.mockResolvedValueOnce([baseUser]).mockResolvedValueOnce({ ok: true });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', '2fa', 'reset', 'alice@example.com']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/users/u1/2fa/reset');
    expect(lines.join('\n')).toContain('2FA reset');
  });

  it('exits 1 when user not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', '2fa', 'reset', 'missing@x.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', '2fa', 'reset', 'alice@example.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── user remove ───────────────────────────────────────────────────────────────

describe('user remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes user by email', async () => {
    mockApi.mockResolvedValueOnce([baseUser]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'user', 'remove', 'alice@example.com']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/users/u1');
    expect(lines.join('\n')).toContain('removed');
  });

  it('URL-encodes user id', async () => {
    const specialUser = { ...baseUser, id: 'u/1+2' };
    mockApi.mockResolvedValueOnce([specialUser]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'user', 'remove', 'alice@example.com']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/users/u%2F1%2B2');
  });

  it('exits 1 when user not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', 'remove', 'missing@x.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on DELETE error', async () => {
    mockApi
      .mockResolvedValueOnce([baseUser])
      .mockRejectedValueOnce(new Error('delete failed'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'user', 'remove', 'alice@example.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('delete failed'));
  });
});
