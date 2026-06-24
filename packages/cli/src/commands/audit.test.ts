import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: vi.fn(),
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
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test',
    serverUrl: 'http://localhost:3000',
    email: 'admin@example.com',
    token: 'jwt-test',
    expiresAt: Date.now() + 3_600_000,
  }),
}));

import { makeAuditCommand } from './audit.js';

afterEach(() => vi.clearAllMocks());

function captureConsole() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, spy };
}

async function run(...args: string[]): Promise<void> {
  const cmd = makeAuditCommand();
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'audit', ...args]);
}

const sampleEntries = [
  {
    id: 'e1',
    timestamp: '2026-06-01T10:00:00.000Z',
    userId: 'u1',
    email: 'admin@example.com',
    endpoint: '/api/models',
    action: 'model:create',
    result: 'success' as const,
    details: { modelId: 'gpt-4' },
  },
  {
    id: 'e2',
    timestamp: '2026-06-02T10:00:00.000Z',
    userId: 'u2',
    email: 'op@example.com',
    endpoint: '/api/auth/login',
    action: 'auth:login',
    result: 'error' as const,
  },
];

describe('routerly audit list', () => {
  it('renders a table with audit entries', async () => {
    mockApi.mockResolvedValue(sampleEntries);
    const { lines, spy } = captureConsole();

    await run('list');

    spy.mockRestore();
    const output = lines.join('\n');
    expect(output).toContain('model:create');
    expect(output).toContain('auth:login');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('/api/audit'));
  });

  it('outputs raw JSON with --json flag', async () => {
    mockApi.mockResolvedValue(sampleEntries);
    const { lines, spy } = captureConsole();

    await run('list', '--json');

    spy.mockRestore();
    const parsed = JSON.parse(lines.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].action).toBe('model:create');
  });

  it('includes user filter in query string when --user is provided', async () => {
    mockApi.mockResolvedValue([sampleEntries[0]!]);
    const { spy } = captureConsole();

    await run('list', '--user', 'admin@example.com');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('userId=admin%40example.com'));
  });
});
