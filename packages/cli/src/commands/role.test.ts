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

import { api } from '../api.js';
import { makeRoleCommand } from './role.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeRoleCommand();
  cmd.exitOverride();
  return cmd;
}

const baseRole = { id: 'viewer', name: 'Viewer', permissions: ['usage:read'] };

// ── role list ─────────────────────────────────────────────────────────────────

describe('role list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table with roles', async () => {
    mockApi.mockResolvedValueOnce([baseRole]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'list']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/roles');
    expect(lines.join('\n')).toContain('Viewer');
    expect(lines.join('\n')).toContain('usage:read');
  });

  it('shows "(none)" for role with no permissions', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseRole, permissions: [] }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'list']);
    expect(lines.join('\n')).toContain('(none)');
  });

  it('marks built-in roles', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseRole, builtin: true }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'list']);
    expect(lines.join('\n')).toContain('built-in');
  });

  it('marks custom roles', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseRole, builtin: false }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'list']);
    expect(lines.join('\n')).toContain('custom');
  });

  it('shows empty state when no roles', async () => {
    mockApi.mockResolvedValueOnce([]);
    await makeCmd().parseAsync(['node', 'role', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No roles'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'role', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network'));
  });
});

// ── role add ──────────────────────────────────────────────────────────────────

describe('role add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates role with id, name, and permissions', async () => {
    mockApi.mockResolvedValueOnce(baseRole);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'add', '--id', 'viewer', '--name', 'Viewer', '--permissions', 'usage:read']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/roles', {
      id: 'viewer',
      name: 'Viewer',
      permissions: ['usage:read'],
    });
    expect(lines.join('\n')).toContain('created');
  });

  it('creates role with no permissions when --permissions omitted', async () => {
    mockApi.mockResolvedValueOnce({ ...baseRole, permissions: [] });
    await makeCmd().parseAsync(['node', 'role', 'add', '--id', 'empty', '--name', 'Empty']);
    const call = mockApi.mock.calls[0]!;
    expect((call[2] as { permissions: unknown[] }).permissions).toEqual([]);
  });

  it('parses comma-separated permissions', async () => {
    mockApi.mockResolvedValueOnce(baseRole);
    await makeCmd().parseAsync(['node', 'role', 'add', '--id', 'dev', '--name', 'Dev', '--permissions', 'usage:read,models:read']);
    const call = mockApi.mock.calls[0]!;
    expect((call[2] as { permissions: string[] }).permissions).toEqual(['usage:read', 'models:read']);
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('conflict'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'role', 'add', '--id', 'x', '--name', 'X'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('conflict'));
  });
});

// ── role edit ─────────────────────────────────────────────────────────────────

describe('role edit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('updates name only', async () => {
    mockApi.mockResolvedValueOnce({ ...baseRole, name: 'Senior Dev' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'edit', 'viewer', '--name', 'Senior Dev']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/roles/viewer', { name: 'Senior Dev' });
    expect(lines.join('\n')).toContain('updated');
  });

  it('updates permissions only', async () => {
    mockApi.mockResolvedValueOnce(baseRole);
    await makeCmd().parseAsync(['node', 'role', 'edit', 'viewer', '--permissions', 'usage:read,models:read']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/roles/viewer', { permissions: ['usage:read', 'models:read'] });
  });

  it('clears permissions with empty string', async () => {
    mockApi.mockResolvedValueOnce({ ...baseRole, permissions: [] });
    await makeCmd().parseAsync(['node', 'role', 'edit', 'viewer', '--permissions', '']);
    const call = mockApi.mock.calls[0]!;
    expect((call[2] as { permissions: string[] }).permissions).toEqual([]);
  });

  it('updates both name and permissions', async () => {
    mockApi.mockResolvedValueOnce(baseRole);
    await makeCmd().parseAsync(['node', 'role', 'edit', 'viewer', '--name', 'X', '--permissions', 'usage:read']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/roles/viewer', { name: 'X', permissions: ['usage:read'] });
  });

  it('exits 1 with no fields', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'role', 'edit', 'viewer'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--name or --permissions'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'role', 'edit', 'missing', '--name', 'X'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

// ── role remove ───────────────────────────────────────────────────────────────

describe('role remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('deletes role by id', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'role', 'remove', 'viewer']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/roles/viewer');
    expect(lines.join('\n')).toContain('deleted');
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('protected'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'role', 'remove', 'admin'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('protected'));
  });
});
