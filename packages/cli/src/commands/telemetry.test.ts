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
import { makeTelemetryCommand } from './telemetry.js';

const mockApi = vi.mocked(api);

const loggedInAccount = {
  alias: 'home',
  serverUrl: 'http://localhost:3000',
  email: 'admin@example.com',
  token: 'tok',
  expiresAt: Date.now() + 3_600_000,
};

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  return makeTelemetryCommand();
}

// ── telemetry status ──────────────────────────────────────────────────────────

describe('telemetry status', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints not-logged-in message when no account', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(null);
    await makeCmd().parseAsync(['node', 'telemetry', 'status']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('prints not configured when telemetry key is absent', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockResolvedValueOnce({});
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'telemetry', 'status']);
    expect(lines.join('\n')).toContain('not configured');
  });

  it('prints enabled with install ID when telemetry.enabled is true', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockResolvedValueOnce({ telemetry: { enabled: true, installId: 'abc-123' } });
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'telemetry', 'status']);
    const out = lines.join('\n');
    expect(out).toContain('enabled');
    expect(out).toContain('abc-123');
  });

  it('prints disabled when telemetry.enabled is false', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockResolvedValueOnce({ telemetry: { enabled: false } });
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'telemetry', 'status']);
    expect(lines.join('\n')).toContain('disabled');
  });

  it('exits 1 on API error', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockRejectedValueOnce(new Error('Network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'telemetry', 'status'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });
});

// ── telemetry on ──────────────────────────────────────────────────────────────

describe('telemetry on', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints not-logged-in message when no account', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(null);
    await makeCmd().parseAsync(['node', 'telemetry', 'on']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('sends PUT with enabled:true and prints success', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockResolvedValueOnce({});
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'telemetry', 'on']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { telemetry: { enabled: true } });
    expect(lines.join('\n')).toContain('enabled');
  });

  it('exits 1 with admin-privileges message on 401', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'telemetry', 'on'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Admin privileges'));
  });

  it('exits 1 with generic error on non-401 error', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockRejectedValueOnce(new Error('timeout'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'telemetry', 'on'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('timeout'));
  });
});

// ── telemetry off ─────────────────────────────────────────────────────────────

describe('telemetry off', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints not-logged-in message when no account', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(null);
    await makeCmd().parseAsync(['node', 'telemetry', 'off']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('sends PUT with enabled:false and prints success', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockResolvedValueOnce({});
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'telemetry', 'off']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { telemetry: { enabled: false } });
    expect(lines.join('\n')).toContain('disabled');
  });

  it('exits 1 with admin-privileges message on 401', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'telemetry', 'off'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Admin privileges'));
  });

  it('exits 1 with generic error on non-401 error', async () => {
    mockGetCurrentAccount.mockResolvedValueOnce(loggedInAccount);
    mockApi.mockRejectedValueOnce(new Error('connection refused'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'telemetry', 'off'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
  });
});
