import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Mock dependencies before importing the command under test ────────────────

const { mockApi, mockRlAnswer } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockRlAnswer: vi.fn((_prompt: string, cb: (ans: string) => void) => cb('y')),
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

// Mock store so we don't touch the filesystem
vi.mock('../store.js', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test',
    serverUrl: 'http://localhost:3000',
    email: 'test@example.com',
    token: 'jwt-test',
    expiresAt: Date.now() + 3_600_000,
  }),
}));

// Mock readline — mockRlAnswer can be overridden per test to simulate user input
vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: mockRlAnswer,
    close: vi.fn(),
  }),
}));

import { makeUpdateCommand } from './update.js';
import { ApiError } from '../api.js';

// ── Capture console output ────────────────────────────────────────────────────

function captureConsole() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, spy };
}

// ── Run a subcommand given argv tokens ────────────────────────────────────────

async function run(...args: string[]): Promise<void> {
  // makeUpdateCommand() returns the 'update' Command directly.
  // Commander treats argv[0]/[1] as executable/script, so subcommands start at [2].
  const cmd = makeUpdateCommand();
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'update', ...args]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks();
});

// ── update check ─────────────────────────────────────────────────────────────

describe('routerly update check', () => {
  const upToDateInfo = {
    available: false,
    currentVersion: '0.1.5',
    latestVersion: '0.1.5',
    channel: 'latest',
    checkedAt: '2026-06-09T10:00:00.000Z',
  };

  const updateAvailableInfo = {
    available: true,
    currentVersion: '0.1.5',
    latestVersion: '1.0.0',
    channel: 'latest',
    releaseUrl: 'https://github.com/Inebrio/Routerly/releases/tag/v1.0.0',
    checkedAt: '2026-06-09T10:00:00.000Z',
  };

  it('prints "up to date" message when no update is available', async () => {
    mockApi.mockResolvedValue(upToDateInfo);
    const { lines, spy } = captureConsole();

    await run('check');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/system/update-check');
    expect(lines.some(l => l.includes('up to date'))).toBe(true);
  });

  it('prints update available message when newer version exists', async () => {
    mockApi.mockResolvedValue(updateAvailableInfo);
    const { lines, spy } = captureConsole();

    await run('check');

    spy.mockRestore();
    expect(lines.some(l => l.includes('1.0.0'))).toBe(true);
    expect(lines.some(l => l.includes('routerly update run'))).toBe(true);
  });

  it('prints release URL when available', async () => {
    mockApi.mockResolvedValue(updateAvailableInfo);
    const { lines, spy } = captureConsole();

    await run('check');

    spy.mockRestore();
    expect(lines.some(l => l.includes('github.com'))).toBe(true);
  });

  it('prints JSON output with --json flag', async () => {
    mockApi.mockResolvedValue(upToDateInfo);
    const { lines, spy } = captureConsole();

    await run('check', '--json');

    spy.mockRestore();
    const combined = lines.join('\n');
    const parsed = JSON.parse(combined);
    expect(parsed.available).toBe(false);
    expect(parsed.currentVersion).toBe('0.1.5');
  });

  it('prints channel and last-checked date in both modes', async () => {
    mockApi.mockResolvedValue(upToDateInfo);
    const { lines, spy } = captureConsole();

    await run('check');

    spy.mockRestore();
    expect(lines.some(l => l.includes('latest'))).toBe(true);
  });
});

// ── update channel ─────────────────────────────────────────────────────────

describe('routerly update channel', () => {
  it('shows current channel when called with no argument', async () => {
    mockApi.mockResolvedValue({ channel: 'stable' });
    const { lines, spy } = captureConsole();

    await run('channel');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/settings');
    expect(lines.some(l => l.includes('stable'))).toBe(true);
  });

  it('shows "latest" as default when channel is not set in settings', async () => {
    mockApi.mockResolvedValue({});
    const { lines, spy } = captureConsole();

    await run('channel');

    spy.mockRestore();
    expect(lines.some(l => l.includes('latest'))).toBe(true);
  });

  it('updates channel when argument is provided', async () => {
    mockApi.mockResolvedValue({ channel: 'develop' });
    const { lines, spy } = captureConsole();

    await run('channel', 'develop');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { channel: 'develop' });
    expect(lines.some(l => l.includes('develop'))).toBe(true);
  });

  it('accepts a specific version tag as channel name', async () => {
    mockApi.mockResolvedValue({ channel: 'v0.2.0' });
    const { lines, spy } = captureConsole();

    await run('channel', 'v0.2.0');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { channel: 'v0.2.0' });
    expect(lines.some(l => l.includes('v0.2.0'))).toBe(true);
  });
});

// ── update run ───────────────────────────────────────────────────────────────

describe('routerly update run', () => {
  it('sends POST /api/system/update and prints the server message', async () => {
    mockRlAnswer.mockImplementation((_prompt: string, cb: (ans: string) => void) => cb('y'));
    mockApi.mockResolvedValueOnce({ message: 'Update started. The service will restart shortly.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { lines, spy } = captureConsole();

    await run('run', '--yes');

    spy.mockRestore();
    vi.unstubAllGlobals();
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/system/update');
    expect(lines.some(l => l.includes('Update started') || l.includes('back online'))).toBe(true);
  });

  it('aborts without calling the API when confirmation is declined', async () => {
    mockRlAnswer.mockImplementation((_prompt: string, cb: (ans: string) => void) => cb('n'));
    const { lines, spy } = captureConsole();

    await run('run');

    spy.mockRestore();
    expect(mockApi).not.toHaveBeenCalled();
    expect(lines.some(l => l.includes('Aborted'))).toBe(true);
  });
});
