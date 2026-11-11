import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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

import { makeApiTokenCommand } from './api-token.js';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeApiTokenCommand();
  cmd.exitOverride();
  return cmd;
}

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
  return lines;
}

const row = {
  id: 'tok-1',
  name: 'ci',
  tokenSnippet: 'sk-rt-api-abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  permissions: ['model:read'],
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('api-token list', () => {
  it('prints rows as JSON', async () => {
    mockApi.mockResolvedValueOnce([row]);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'api-token', 'list', '--json']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/me/api-tokens');
    expect(JSON.parse(lines.join('\n'))).toEqual([row]);
  });

  it('hints how to create when empty', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'api-token', 'list']);
    expect(lines.join('\n')).toContain('api-token create');
  });
});

describe('api-token create', () => {
  it('sends permissions and an expiry derived from --days, reveals token once', async () => {
    mockApi.mockResolvedValueOnce({ ...row, token: 'sk-rt-api-raw' });
    const lines = captureLog();
    const before = Date.now();
    await makeCmd().parseAsync(['node', 'api-token', 'create', 'ci', '--permissions', 'model:read, router:read', '--days', '30']);
    const [method, path, body] = mockApi.mock.calls[0]!;
    expect([method, path]).toEqual(['POST', '/api/me/api-tokens']);
    expect(body.name).toBe('ci');
    expect(body.permissions).toEqual(['model:read', 'router:read']);
    const delta = new Date(body.expiresAt).getTime() - before;
    expect(delta).toBeGreaterThan(29.9 * 86_400_000);
    expect(delta).toBeLessThan(30.1 * 86_400_000);
    expect(lines.join('\n')).toContain('sk-rt-api-raw');
    expect(lines.join('\n')).toContain('shown only once');
  });

  it('rejects --days out of range before calling the API', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'api-token', 'create', 'ci', '--permissions', 'model:read', '--days', '400'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApi).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('requires --permissions', async () => {
    await expect(makeCmd().parseAsync(['node', 'api-token', 'create', 'ci'])).rejects.toThrow();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('api-token revoke', () => {
  it('deletes the token', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    captureLog();
    await makeCmd().parseAsync(['node', 'api-token', 'revoke', 'tok-1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/me/api-tokens/tok-1');
  });

  it('exits 1 on 404', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(404, 'nf'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'api-token', 'revoke', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
