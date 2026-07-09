import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockApiWith,
  mockApi,
  mockListAccounts,
  mockGetCurrentAccount,
  mockGetAccount,
  mockSaveAccount,
  mockRemoveAccount,
  mockRenameAccount,
  mockSwitchAccount,
  mockGetDefaultServiceUrl,
} = vi.hoisted(() => ({
  mockApiWith: vi.fn(),
  mockApi: vi.fn(),
  mockListAccounts: vi.fn(),
  mockGetCurrentAccount: vi.fn(),
  mockGetAccount: vi.fn(),
  mockSaveAccount: vi.fn(),
  mockRemoveAccount: vi.fn(),
  mockRenameAccount: vi.fn(),
  mockSwitchAccount: vi.fn(),
  mockGetDefaultServiceUrl: vi.fn(),
}));

vi.mock('../api.js', () => ({
  apiWith: mockApiWith,
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
  listAccounts: mockListAccounts,
  getCurrentAccount: mockGetCurrentAccount,
  getAccount: mockGetAccount,
  saveAccount: mockSaveAccount,
  removeAccount: mockRemoveAccount,
  renameAccount: mockRenameAccount,
  switchAccount: mockSwitchAccount,
  getDefaultServiceUrl: mockGetDefaultServiceUrl,
}));

import { makeAuthCommand } from './auth.js';
import { ApiError } from '../api.js';

afterEach(() => vi.clearAllMocks());

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCmd() {
  const cmd = makeAuthCommand();
  cmd.exitOverride();
  return cmd;
}

/** Build a minimal valid JWT-like token with exp payload (base64url). */
function makeToken(expMs: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expMs })).toString('base64url');
  return `${payload}.sig`;
}

const futureExp = Date.now() + 3_600_000;

const baseAccount = {
  alias: 'default',
  serverUrl: 'http://localhost:3000',
  email: 'admin@example.com',
  token: makeToken(futureExp),
  expiresAt: futureExp,
  role: 'admin',
  refreshToken: 'rt-abc',
};

// ── auth login ────────────────────────────────────────────────────────────────

describe('auth login', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetDefaultServiceUrl.mockResolvedValue(null);
    mockSaveAccount.mockResolvedValue(undefined);
  });

  it('first-ever login: saves as "default" alias', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });
    vi.doMock('inquirer', () => ({ default: { prompt: vi.fn() } }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'default' }));
    vi.doUnmock('inquirer');
  });

  it('second login with new email: uses email-base as alias', async () => {
    mockListAccounts.mockResolvedValue([{ ...baseAccount, alias: 'default', email: 'other@example.com' }]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u2', email: 'alice@example.com', role: 'viewer' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'alice@example.com',
      '--password', 'secret',
    ]);

    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'alice' }));
  });

  it('login with --alias flag uses that alias', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
      '--alias', 'work',
    ]);

    // First account ever → alias forced to 'default' regardless
    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'default' }));
  });

  it('new email with non-conflicting --alias uses that alias', async () => {
    mockListAccounts.mockResolvedValue([{ ...baseAccount, email: 'other@x.com', alias: 'default' }]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u2', email: 'new@x.com', role: 'viewer' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'new@x.com',
      '--password', 'p',
      '--alias', 'staging',
    ]);

    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'staging' }));
  });

  it('new email with conflicting --alias: prompts overwrite/add', async () => {
    mockListAccounts.mockResolvedValue([{ ...baseAccount, email: 'other@x.com', alias: 'staging' }]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u2', email: 'new@x.com', role: 'viewer' },
    });

    // First inquirer import in login for alias conflict prompt
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // alias conflict → overwrite
          .mockResolvedValueOnce({ action: 'overwrite' }),
      },
    }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'new@x.com',
      '--password', 'p',
      '--alias', 'staging',
    ]);

    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'staging' }));
    vi.doUnmock('inquirer');
  });

  it('new email with conflicting --alias: add generates next-free alias', async () => {
    mockListAccounts.mockResolvedValue([
      { ...baseAccount, email: 'other@x.com', alias: 'staging' },
    ]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u2', email: 'new@x.com', role: 'viewer' },
    });

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ action: 'add' }),
      },
    }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'new@x.com',
      '--password', 'p',
      '--alias', 'staging',
    ]);

    // staging taken → staging-2
    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'staging-2' }));
    vi.doUnmock('inquirer');
  });

  it('same email already exists: overwrite keeps existing alias', async () => {
    mockListAccounts.mockResolvedValue([{ ...baseAccount, email: 'admin@example.com', alias: 'work' }]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // first call: alias conflict prompt (same email) → overwrite
          .mockResolvedValueOnce({ action: 'overwrite' }),
      },
    }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'work' }));
    vi.doUnmock('inquirer');
  });

  it('same email already exists: add generates new alias', async () => {
    mockListAccounts.mockResolvedValue([{ ...baseAccount, email: 'admin@example.com', alias: 'admin' }]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ action: 'add' }),
      },
    }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    // emailBase='admin' is taken → 'admin-2'
    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'admin-2' }));
    vi.doUnmock('inquirer');
  });

  it('stores refreshToken when returned', async () => {
    mockListAccounts.mockResolvedValue([]);
    const token = makeToken(futureExp);
    mockApiWith.mockResolvedValueOnce({
      token,
      refreshToken: 'rt-xyz',
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'rt-xyz' }));
  });

  it('omits refreshToken when not returned', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    const saved = mockSaveAccount.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('refreshToken');
  });

  it('decodes exp from token payload', async () => {
    mockListAccounts.mockResolvedValue([]);
    const exp = Math.floor((Date.now() + 7200_000) / 1000); // 2h ahead in seconds
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    mockApiWith.mockResolvedValueOnce({
      token: `${payload}.sig`,
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    const saved = mockSaveAccount.mock.calls[0]![0] as { expiresAt: number };
    expect(saved.expiresAt).toBe(exp);
  });

  it('falls back to 24h expiry when token payload unparseable', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: 'invalid.token',
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });
    const before = Date.now();

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
    ]);

    const saved = mockSaveAccount.mock.calls[0]![0] as { expiresAt: number };
    // Should be approximately 24h ahead
    expect(saved.expiresAt).toBeGreaterThan(before + 23 * 3600_000);
    expect(saved.expiresAt).toBeLessThan(before + 25 * 3600_000);
  });

  it('prompts for email and password when not provided', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    const promptMock = vi.fn()
      .mockResolvedValueOnce({ email: 'admin@example.com', password: 'secret' });

    vi.doMock('inquirer', () => ({ default: { prompt: promptMock } }));

    await makeCmd().parseAsync(['node', 'auth', 'login']);

    expect(promptMock).toHaveBeenCalled();
    expect(mockApiWith).toHaveBeenCalledWith(
      expect.anything(), 'POST', '/api/auth/login',
      expect.objectContaining({ email: 'admin@example.com', password: 'secret' }),
    );
    vi.doUnmock('inquirer');
  });

  it('prompts only for password when --email is provided', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    const promptMock = vi.fn().mockResolvedValueOnce({ password: 'secret' });
    vi.doMock('inquirer', () => ({ default: { prompt: promptMock } }));

    await makeCmd().parseAsync(['node', 'auth', 'login', '--email', 'admin@example.com']);

    // The questions array should only contain the password question
    const questions = promptMock.mock.calls[0]![0] as Array<{ name: string }>;
    expect(questions.every((q) => q.name !== 'email')).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('same email + add + free opts.alias: uses opts.alias directly', async () => {
    // sameEmail branch → action='add' → opts.alias provided and not in existing set
    mockListAccounts.mockResolvedValue([{ ...baseAccount, email: 'admin@example.com', alias: 'work' }]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // same-email conflict → add as new
          .mockResolvedValueOnce({ action: 'add' }),
      },
    }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'admin@example.com',
      '--password', 'secret',
      '--alias', 'home',
    ]);

    // 'home' not in existing set ('work') → used directly
    expect(mockSaveAccount).toHaveBeenCalledWith(expect.objectContaining({ alias: 'home' }));
    vi.doUnmock('inquirer');
  });

  it('prompts only for email when --password is provided', async () => {
    // Covers the (!password ? [...] : []) false branch and the (if (!email)) true branch
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });

    const promptMock = vi.fn().mockResolvedValueOnce({ email: 'admin@example.com' });
    vi.doMock('inquirer', () => ({ default: { prompt: promptMock } }));

    await makeCmd().parseAsync(['node', 'auth', 'login', '--password', 'secret']);

    // Only email question should be in the prompt array
    const questions = promptMock.mock.calls[0]![0] as Array<{ name: string }>;
    expect(questions.every((q) => q.name !== 'password')).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('handles 2FA challenge', async () => {
    mockListAccounts.mockResolvedValue([]);
    // First API call returns 2FA challenge
    mockApiWith
      .mockResolvedValueOnce({ requiresTotp: true, userId: 'u1', token: '', user: { id: 'u1', email: 'a@b.com', role: 'viewer' } })
      // Second call (verify) returns real token
      .mockResolvedValueOnce({
        token: makeToken(futureExp),
        user: { id: 'u1', email: 'a@b.com', role: 'viewer' },
      });

    // inquirer prompt twice: first for email/password (skipped - provided), then for TOTP
    vi.doMock('inquirer', () => ({
      default: { prompt: vi.fn().mockResolvedValueOnce({ totpCode: '123456' }) },
    }));

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'a@b.com',
      '--password', 'p',
    ]);

    expect(mockApiWith).toHaveBeenCalledWith(
      expect.anything(), 'POST', '/api/auth/2fa/verify',
      { userId: 'u1', token: '123456' },
    );
    expect(mockSaveAccount).toHaveBeenCalled();
    vi.doUnmock('inquirer');
  });

  it('uses --url flag as server URL', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'a@b.com', role: 'admin' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--url', 'http://prod.example.com/',
      '--email', 'a@b.com',
      '--password', 'p',
    ]);

    const savedAccount = mockSaveAccount.mock.calls[0]![0] as { serverUrl: string };
    expect(savedAccount.serverUrl).toBe('http://prod.example.com');
  });

  it('uses getDefaultServiceUrl when no --url given', async () => {
    mockGetDefaultServiceUrl.mockResolvedValue('http://default-server.com');
    mockListAccounts.mockResolvedValue([]);
    mockApiWith.mockResolvedValueOnce({
      token: makeToken(futureExp),
      user: { id: 'u1', email: 'a@b.com', role: 'admin' },
    });

    await makeCmd().parseAsync([
      'node', 'auth', 'login',
      '--email', 'a@b.com',
      '--password', 'p',
    ]);

    const savedAccount = mockSaveAccount.mock.calls[0]![0] as { serverUrl: string };
    expect(savedAccount.serverUrl).toBe('http://default-server.com');
  });

  it('exits 1 on ApiError (wrong credentials)', async () => {
    mockApiWith.mockRejectedValueOnce(new ApiError(401, 'Invalid credentials'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(
      makeCmd().parseAsync([
        'node', 'auth', 'login',
        '--email', 'a@b.com',
        '--password', 'wrong',
      ])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid credentials'));
  });

  it('exits 1 on network error', async () => {
    mockApiWith.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(
      makeCmd().parseAsync([
        'node', 'auth', 'login',
        '--email', 'a@b.com',
        '--password', 'p',
      ])
    ).rejects.toThrow('exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});

// ── auth refresh ──────────────────────────────────────────────────────────────

describe('auth refresh', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refreshes token for current account', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockSaveAccount.mockResolvedValue(undefined);

    const newToken = makeToken(futureExp + 3600_000);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ token: newToken }), { status: 200 }),
    );

    await makeCmd().parseAsync(['node', 'auth', 'refresh']);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockSaveAccount).toHaveBeenCalledWith(
      expect.objectContaining({ token: newToken }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('refreshed'));
    fetchMock.mockRestore();
  });

  it('refreshes token for named account via alias arg', async () => {
    mockGetAccount.mockResolvedValue(baseAccount);
    mockSaveAccount.mockResolvedValue(undefined);

    const newToken = makeToken(futureExp);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ token: newToken }), { status: 200 }),
    );

    await makeCmd().parseAsync(['node', 'auth', 'refresh', 'default']);

    expect(mockGetAccount).toHaveBeenCalledWith('default');
    expect(mockSaveAccount).toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('decodes exp from refreshed token', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockSaveAccount.mockResolvedValue(undefined);

    const exp = Math.floor((Date.now() + 7200_000) / 1000);
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ token: `${payload}.sig` }), { status: 200 }),
    );

    await makeCmd().parseAsync(['node', 'auth', 'refresh']);

    const saved = mockSaveAccount.mock.calls[0]![0] as { expiresAt: number };
    expect(saved.expiresAt).toBe(exp);
    fetchMock.mockRestore();
  });

  it('falls back to 1h expiry on bad token payload', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockSaveAccount.mockResolvedValue(undefined);
    const before = Date.now();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'bad.token' }), { status: 200 }),
    );

    await makeCmd().parseAsync(['node', 'auth', 'refresh']);

    const saved = mockSaveAccount.mock.calls[0]![0] as { expiresAt: number };
    expect(saved.expiresAt).toBeGreaterThan(before + 59 * 60_000);
    expect(saved.expiresAt).toBeLessThan(before + 61 * 60_000);
    fetchMock.mockRestore();
  });

  it('exits 1 when not logged in (no current account)', async () => {
    mockGetCurrentAccount.mockResolvedValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
  });

  it('exits 1 when named alias not found', async () => {
    mockGetAccount.mockResolvedValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh', 'missing'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"missing"'));
  });

  it('exits 1 when account has no refresh token', async () => {
    mockGetCurrentAccount.mockResolvedValue({ ...baseAccount, refreshToken: undefined });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No refresh token'));
  });

  it('exits 1 and shows "revoked" on 401 response', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 }),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('revoked'));
    fetchMock.mockRestore();
  });

  it('exits 1 with generic error on non-401 failure (with body.error)', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'server error' }), { status: 500 }),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
    fetchMock.mockRestore();
  });

  it('uses statusText when refresh error body has no error field', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    // Response with non-ok status but no parseable error field → falls back to statusText
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', { status: 503, statusText: 'Service Unavailable' }),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Service Unavailable'));
    fetchMock.mockRestore();
  });

  it('exits 1 on network exception', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(makeCmd().parseAsync(['node', 'auth', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    fetchMock.mockRestore();
  });
});

// ── auth logout ───────────────────────────────────────────────────────────────

describe('auth logout', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs out current account', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockRemoveAccount.mockResolvedValue(true);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'logout']);
    expect(mockRemoveAccount).toHaveBeenCalledWith('default');
    expect(lines.join('\n')).toContain('Logged out');
  });

  it('logs out named account by alias', async () => {
    mockRemoveAccount.mockResolvedValue(true);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'logout', 'staging']);
    expect(mockRemoveAccount).toHaveBeenCalledWith('staging');
    expect(lines.join('\n')).toContain('staging');
  });

  it('exits 1 when no current account and no alias given', async () => {
    mockGetCurrentAccount.mockResolvedValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'logout'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No account'));
  });

  it('exits 1 when account not found by alias', async () => {
    mockRemoveAccount.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'logout', 'ghost'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"ghost"'));
  });
});

// ── auth ps ───────────────────────────────────────────────────────────────────

describe('auth ps', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table of accounts', async () => {
    mockListAccounts.mockResolvedValue([baseAccount]);
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'ps']);
    expect(lines.join('\n')).toContain('admin@example.com');
  });

  it('marks current account with *', async () => {
    mockListAccounts.mockResolvedValue([baseAccount]);
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'ps']);
    expect(lines.join('\n')).toContain('*');
  });

  it('shows expired label for expired account', async () => {
    const expiredAccount = { ...baseAccount, expiresAt: Date.now() - 1000 };
    mockListAccounts.mockResolvedValue([expiredAccount]);
    mockGetCurrentAccount.mockResolvedValue(expiredAccount);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'ps']);
    expect(lines.join('\n')).toContain('expired');
  });

  it('shows dash for missing role', async () => {
    const noRole = { ...baseAccount, role: undefined };
    mockListAccounts.mockResolvedValue([noRole]);
    mockGetCurrentAccount.mockResolvedValue(noRole);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'ps']);
    expect(lines.join('\n')).toContain('—');
  });

  it('shows empty state message when no accounts', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockGetCurrentAccount.mockResolvedValue(null);
    await makeCmd().parseAsync(['node', 'auth', 'ps']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No accounts'));
  });

  it('renders account not marked as current (not active)', async () => {
    mockListAccounts.mockResolvedValue([baseAccount]);
    mockGetCurrentAccount.mockResolvedValue({ ...baseAccount, alias: 'other' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'ps']);
    // no * because it's not the current account
    expect(lines.join('\n')).toContain('admin@example.com');
  });
});

// ── auth switch ───────────────────────────────────────────────────────────────

describe('auth switch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('switches to existing account', async () => {
    mockSwitchAccount.mockResolvedValue(true);
    mockGetAccount.mockResolvedValue(baseAccount);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'switch', 'default']);
    expect(mockSwitchAccount).toHaveBeenCalledWith('default');
    expect(lines.join('\n')).toContain('Switched');
  });

  it('exits 1 when account not found', async () => {
    mockSwitchAccount.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'switch', 'ghost'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"ghost"'));
  });
});

// ── auth rename ───────────────────────────────────────────────────────────────

describe('auth rename', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renames an existing account', async () => {
    mockRenameAccount.mockResolvedValue('ok');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'rename', 'default', 'work']);
    expect(mockRenameAccount).toHaveBeenCalledWith('default', 'work');
    expect(lines.join('\n')).toContain('renamed');
  });

  it('exits 1 when old alias not found', async () => {
    mockRenameAccount.mockResolvedValue('not_found');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'rename', 'ghost', 'new'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"ghost"'));
  });

  it('exits 1 when new alias conflicts', async () => {
    mockRenameAccount.mockResolvedValue('conflict');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'rename', 'old', 'taken'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"taken"'));
  });
});

// ── auth whoami ───────────────────────────────────────────────────────────────

describe('auth whoami', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints email and role from server', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockApi.mockResolvedValueOnce({ id: 'u1', email: 'admin@example.com', roleId: 'admin' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'whoami']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/me');
    expect(lines.join('\n')).toContain('admin@example.com');
    expect(lines.join('\n')).toContain('admin');
  });

  it('prints server and account info', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockApi.mockResolvedValueOnce({ id: 'u1', email: 'admin@example.com', roleId: 'admin' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'whoami']);
    expect(lines.join('\n')).toContain('http://localhost:3000');
    expect(lines.join('\n')).toContain('default');
  });

  it('prints "Not logged in" when no account', async () => {
    mockGetCurrentAccount.mockResolvedValue(null);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'auth', 'whoami']);
    expect(lines.join('\n')).toContain('Not logged in');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('exits 1 with "Session expired" on 401', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockApi.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'whoami'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('exits 1 with generic error on other failures', async () => {
    mockGetCurrentAccount.mockResolvedValue(baseAccount);
    mockApi.mockRejectedValueOnce(new Error('network failure'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'auth', 'whoami'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network failure'));
  });
});
