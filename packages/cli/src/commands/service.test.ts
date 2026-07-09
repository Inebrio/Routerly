import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { mockApi, mockRequireAccount, mockGetCurrentAccount } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockRequireAccount: vi.fn(),
  mockGetCurrentAccount: vi.fn(),
}));

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
  getCurrentAccount: mockGetCurrentAccount,
  requireAccount: mockRequireAccount,
}));

import { makeServiceCommand } from './service.js';
import { ApiError } from '../api.js';

afterEach(() => vi.clearAllMocks());

const account = {
  alias: 'test',
  serverUrl: 'http://localhost:3000',
  email: 'admin@example.com',
  token: 'jwt-test',
  expiresAt: Date.now() + 3_600_000,
};

function makeCmd() {
  const cmd = makeServiceCommand();
  cmd.exitOverride();
  return cmd;
}

async function run(...args: string[]) {
  await makeCmd().parseAsync(['node', 'service', ...args]);
}

// ── service status ─────────────────────────────────────────────────────────────

describe('service status', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints not-logged-in message when no account', async () => {
    mockGetCurrentAccount.mockResolvedValue(null);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('status');
    expect(lines.join(' ')).toContain('Not logged in');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('prints status table when logged in', async () => {
    mockGetCurrentAccount.mockResolvedValue(account);
    mockApi
      .mockResolvedValueOnce({ version: '0.3.0', uptime: 125, nodeVersion: 'v22.0.0' }) // system/info
      .mockResolvedValueOnce({ port: 3000, host: '0.0.0.0', dashboardEnabled: true, logLevel: 'info', defaultTimeoutMs: 30000 }) // settings
      .mockResolvedValueOnce([{}, {}]) // models
      .mockResolvedValueOnce([{}]); // projects
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('status');
    const out = lines.join('\n');
    expect(out).toContain('0.3.0');
    expect(out).toContain('2m 5s'); // 125s = 2m 5s
    expect(out).toContain('3000');
    expect(out).toContain('enabled');
  });

  it('omits version/uptime when system/info fails', async () => {
    mockGetCurrentAccount.mockResolvedValue(account);
    mockApi
      .mockRejectedValueOnce(new Error('unreachable')) // system/info catch → null
      .mockResolvedValueOnce({ port: 8080, host: '127.0.0.1', dashboardEnabled: false, logLevel: 'warn', defaultTimeoutMs: 5000 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('status');
    const out = lines.join('\n');
    expect(out).toContain('8080');
    expect(out).not.toContain('Version:');
  });

  it('exits 1 on API error (settings fails)', async () => {
    mockGetCurrentAccount.mockResolvedValue(account);
    // system/info resolves, settings rejects
    mockApi
      .mockResolvedValueOnce({ version: '0.3.0', uptime: 0, nodeVersion: 'v22' })
      .mockRejectedValueOnce(new Error('settings error'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('status')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('settings error'));
  });

  it('shows dashboard disabled when dashboardEnabled is false', async () => {
    mockGetCurrentAccount.mockResolvedValue(account);
    mockApi
      .mockResolvedValueOnce(null as unknown as never) // system/info returns null
      .mockResolvedValueOnce({ port: 3000, host: '0.0.0.0', dashboardEnabled: false, logLevel: 'info', defaultTimeoutMs: 5000 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('status');
    expect(lines.join('\n')).toContain('disabled');
  });
});

// ── service configure ──────────────────────────────────────────────────────────

describe('service configure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints usage hint when no options provided', async () => {
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('configure');
    expect(lines.join(' ')).toContain('No settings provided');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('sends PUT with port and host', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--port', '8080', '--host', '0.0.0.0');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ port: 8080, host: '0.0.0.0' }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('updated'));
  });

  it('sends PUT with dashboard=false when --dashboard false', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--dashboard', 'false');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ dashboardEnabled: false }));
  });

  it('sends PUT with dashboard=true when --dashboard true', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--dashboard', 'true');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ dashboardEnabled: true }));
  });

  it('sends PUT with logLevel', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--log-level', 'debug');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ logLevel: 'debug' }));
  });

  it('sends PUT with defaultTimeoutMs', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--timeout', '60000');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ defaultTimeoutMs: 60000 }));
  });

  it('sends PUT with metricsEnabled=true when --metrics true', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--metrics', 'true');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ metricsEnabled: true }));
  });

  it('sends PUT with metricsEnabled=false when --metrics false', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--metrics', 'false');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ metricsEnabled: false }));
  });

  it('sends prometheusAuthToken when --metrics-token provided', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--metrics-token', 'mysecret');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', expect.objectContaining({ prometheusAuthToken: 'mysecret' }));
  });

  it('sets prometheusAuthToken to undefined when --metrics-token is empty string', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await run('configure', '--metrics-token', '');
    const call = mockApi.mock.calls[0];
    const patch = call![2] as Record<string, unknown>;
    expect(patch['prometheusAuthToken']).toBeUndefined();
  });

  it('exits 1 with admin-required message on 401', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('configure', '--port', '8080')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Admin'));
  });

  it('exits 1 with generic error on non-401 ApiError', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(500, 'Internal error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('configure', '--port', '8080')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Internal error'));
  });

  it('exits 1 with generic error on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('network failure'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('configure', '--port', '8080')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network failure'));
  });
});

// ── service health ─────────────────────────────────────────────────────────────

describe('service health', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const healthData = [
    { modelId: 'gpt-4', provider: 'openai', status: 'healthy' as const, errorRate: 0.01, p95LatencyMs: 340, requestsPerHour: 120, lastSuccess: '2026-07-08T10:00:00.000Z' },
    { modelId: 'claude-3', provider: 'anthropic', status: 'degraded' as const },
    { modelId: 'llama-3', provider: 'ollama', status: 'unavailable' as const },
  ];

  it('renders a table with provider health data', async () => {
    mockApi.mockResolvedValueOnce(healthData);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('health');
    const out = lines.join('\n');
    expect(out).toContain('gpt-4');
    expect(out).toContain('openai');
    expect(out).toContain('healthy');
    expect(out).toContain('degraded');
    expect(out).toContain('unavailable');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValueOnce(healthData);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('health', '--json');
    const parsed = JSON.parse(lines.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].modelId).toBe('gpt-4');
  });

  it('shows empty message when no health data', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('health');
    expect(lines.join(' ')).toContain('No provider health data');
  });

  it('renders dash for missing optional fields', async () => {
    mockApi.mockResolvedValueOnce([
      { modelId: 'gpt-4', provider: 'openai', status: 'healthy' as const },
    ]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('health');
    // null-ish fields render as gray "—"
    expect(lines.join('\n')).toContain('gpt-4');
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('health')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network error'));
  });
});

// ── service metrics ────────────────────────────────────────────────────────────

describe('service metrics', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const prometheusText = `# HELP routerly_requests_total Total requests
# TYPE routerly_requests_total counter
routerly_requests_total 42
routerly_tokens_total 1000

# a comment line
bad_line_no_space
metric_with_nan_value not_a_number
`;

  it('renders a table from Prometheus text format', async () => {
    mockRequireAccount.mockResolvedValue(account);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => prometheusText,
    }));
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('metrics');
    vi.unstubAllGlobals();
    const out = lines.join('\n');
    expect(out).toContain('routerly_requests_total');
    expect(out).toContain('42');
    expect(out).toContain('1000');
  });

  it('prints raw text with --raw flag', async () => {
    mockRequireAccount.mockResolvedValue(account);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => prometheusText,
    }));
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('metrics', '--raw');
    vi.unstubAllGlobals();
    expect(lines.join('\n')).toContain('routerly_requests_total counter');
  });

  it('shows empty message when Prometheus text has no parseable metrics', async () => {
    mockRequireAccount.mockResolvedValue(account);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# HELP foo bar\n# TYPE foo counter\n',
    }));
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('metrics');
    vi.unstubAllGlobals();
    expect(lines.join(' ')).toContain('No metrics available');
  });

  it('exits 1 when fetch response is not ok', async () => {
    mockRequireAccount.mockResolvedValue(account);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Unauthorized',
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('metrics')).rejects.toThrow('exit');
    vi.unstubAllGlobals();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
  });

  it('exits 1 when fetch throws', async () => {
    mockRequireAccount.mockResolvedValue(account);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('metrics')).rejects.toThrow('exit');
    vi.unstubAllGlobals();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
  });

  it('uses trailing-slash-stripped serverUrl for /metrics URL', async () => {
    mockRequireAccount.mockResolvedValue({ ...account, serverUrl: 'http://localhost:3000/' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'metric_a 1\n' });
    vi.stubGlobal('fetch', fetchMock);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    await run('metrics');
    vi.unstubAllGlobals();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/metrics',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-test' }) }),
    );
  });
});
