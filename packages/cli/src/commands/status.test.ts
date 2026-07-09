import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { mockGetCurrentAccount } = vi.hoisted(() => ({
  mockGetCurrentAccount: vi.fn(),
}));

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

vi.mock('../store.js', () => ({
  getCurrentAccount: mockGetCurrentAccount,
}));

import { api, ApiError } from '../api.js';
import { makeStatusCommand } from './status.js';

const mockApi = vi.mocked(api);

const baseAccount = {
  alias: 'home',
  serverUrl: 'http://localhost:3000',
  email: 'admin@example.com',
  token: 'tok',
  expiresAt: Date.now() + 3_600_000,
  role: 'admin',
};

const expiredAccount = {
  ...baseAccount,
  expiresAt: Date.now() - 1000,
};

function makeCmd() {
  return makeStatusCommand();
}

afterEach(() => vi.clearAllMocks());

// ── --json output ─────────────────────────────────────────────────────────────

describe('status --json', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('outputs loggedIn:false when no account', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(null);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out).toMatchObject({ loggedIn: false });
  });

  it('includes account and service info when logged in and token valid', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    // Promise.all: info, settings, models, projects
    mockApi
      .mockResolvedValueOnce({ version: '1.2.3', uptimeSeconds: 3661, nodeVersion: 'v22.0.0' })
      .mockResolvedValueOnce({ host: '0.0.0.0', port: 3000, dashboardEnabled: true, logLevel: 'info' })
      .mockResolvedValueOnce([{}, {}])
      .mockResolvedValueOnce([{}, {}, {}]);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out.loggedIn).toBe(true);
    expect(out.account.alias).toBe('home');
    expect(out.account.tokenValid).toBe(true);
    expect(out.service.reachable).toBe(true);
    expect(out.service.version).toBe('1.2.3');
    expect(out.service.modelCount).toBe(2);
    expect(out.service.projectCount).toBe(3);
    expect(out.service.dashboardUrl).toBe('http://localhost:3000/dashboard/');
  });

  it('sets service.reachable:false when info call fails', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockRejectedValueOnce(new Error('no info'))  // info
      .mockResolvedValueOnce({ host: '0.0.0.0', port: 3000, dashboardEnabled: false, logLevel: 'debug' })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out.service.reachable).toBe(false);
    expect(out.service.version).toBeNull();
    expect(out.service.dashboardUrl).toBeNull();
    expect(out.service.listeningAddr).toBe('0.0.0.0:3000');
  });

  it('sets service.reachable:false when expired token (no API calls)', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(expiredAccount);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out.loggedIn).toBe(true);
    expect(out.account.tokenValid).toBe(false);
    expect(out.service).toBeNull();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('handles all API calls failing gracefully (each resolved to null)', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    // Each call rejects but is caught by .catch(() => null) → all null
    mockApi
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockRejectedValueOnce(new Error('c'))
      .mockRejectedValueOnce(new Error('d'));

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out.service.reachable).toBe(false);
    expect(out.service.modelCount).toBeNull();
    expect(out.service.projectCount).toBeNull();
  });

  it('outer catch fires when api throws synchronously in JSON mode', async () => {
    // Synchronous throw bypasses .catch() on the returned promise because
    // the throw happens before api() returns a promise — triggers the outer catch (line 72).
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi.mockImplementation(() => { throw new Error('sync-boom'); });

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    // outer catch sets service = { reachable: false }
    expect(out.service).toMatchObject({ reachable: false });
  });

  it('sets dashboardUrl null when dashboardEnabled is false', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockResolvedValueOnce({ version: '1.0.0', uptimeSeconds: 10 })
      .mockResolvedValueOnce({ dashboardEnabled: false, logLevel: 'info' })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out.service.dashboardUrl).toBeNull();
  });

  it('account.role is null when no role in account', async () => {
    const { role: _, ...noRoleAccount } = baseAccount;
    mockGetCurrentAccount.mockResolvedValueOnce(noRoleAccount);
    mockApi
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status', '--json']);
    const out = JSON.parse(lines.join('\n'));
    expect(out.account.role).toBeNull();
  });
});

// ── human-readable output ─────────────────────────────────────────────────────

describe('status (human-readable)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows not-logged-in when no account', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(null);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('not logged in');
  });

  it('shows expired message when token is expired', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(expiredAccount);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    const out = lines.join('\n');
    expect(out).toContain('expired');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('shows full account and service info', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockResolvedValueOnce({ version: '2.0.0', uptimeSeconds: 7200, nodeVersion: 'v22.0.0' })
      .mockResolvedValueOnce({ host: '127.0.0.1', port: 8080, dashboardEnabled: true, logLevel: 'warn' })
      .mockResolvedValueOnce([{}, {}])
      .mockResolvedValueOnce([{}]);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    const out = lines.join('\n');
    expect(out).toContain('home');
    expect(out).toContain('2.0.0');
    expect(out).toContain('127.0.0.1:8080');
    expect(out).toContain('/dashboard/');
    expect(out).toContain('warn');
    expect(out).toContain('2');  // models count
    expect(out).toContain('1');  // projects count
  });

  it('shows dashboard disabled when dashboardEnabled is false', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockResolvedValueOnce({ version: '1.0.0', uptimeSeconds: 60 })
      .mockResolvedValueOnce({ dashboardEnabled: false, logLevel: 'debug' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('disabled');
  });

  it('shows unreachable when info call returns null', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockRejectedValueOnce(new Error('refused'))  // info → null via catch()
      .mockRejectedValueOnce(new Error('refused'))
      .mockRejectedValueOnce(new Error('refused'))
      .mockRejectedValueOnce(new Error('refused'));

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('no — server did not respond');
  });

  it('shows unauthorized when outer try-catch sees a 401 ApiError', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    // Make Promise.all itself reject (not caught internally) — simulate by
    // having all individual catches pass and then the outer block throw 401.
    // The .catch(() => null) on each call means Promise.all never rejects;
    // to hit the outer catch we need to make api() throw before .catch.
    // Use an implementation that throws synchronously.
    mockApi.mockImplementation(() => { throw new ApiError(401, 'unauthorized'); });

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('unauthorized');
  });

  it('shows error message when outer catch sees a non-401 error', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi.mockImplementation(() => { throw new Error('boom'); });

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('boom');
  });

  it('shows role in account line when role is present', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce({ ...baseAccount, role: 'viewer' });
    mockApi
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'));

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('viewer');
  });

  it('omits role from account line when role is absent', async () => {
    // Covers the `account.role ? ... : ''` false branch on line 94
    const { role: _, ...noRoleAccount } = baseAccount;
    mockGetCurrentAccount.mockResolvedValueOnce(noRoleAccount);
    mockApi
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'));

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    const out = lines.join('\n');
    expect(out).toContain('home');
    expect(out).not.toContain('role:');
  });

  it('shows uptime in minutes+seconds format', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockResolvedValueOnce({ version: '1.0.0', uptimeSeconds: 90 }) // 1m 30s
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toMatch(/1m \d+s/);
  });

  it('shows uptime in seconds when less than one minute', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockResolvedValueOnce({ version: '1.0.0', uptimeSeconds: 45 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    expect(lines.join('\n')).toContain('45s');
  });

  it('shows models and projects count only when not null', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(baseAccount);
    mockApi
      .mockResolvedValueOnce({ version: '1.0.0', uptimeSeconds: 5 })
      .mockResolvedValueOnce({ dashboardEnabled: false, logLevel: 'info' })
      .mockResolvedValueOnce(null)   // models → null
      .mockResolvedValueOnce(null);  // projects → null

    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'status']);
    const out = lines.join('\n');
    expect(out).not.toContain('Models:');
    expect(out).not.toContain('Projects:');
  });
});
