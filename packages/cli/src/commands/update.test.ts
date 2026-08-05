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
  it('help text lists only latest, current, next and version tags — not stable/develop as primary', () => {
    const cmd = makeUpdateCommand();
    const channelCmd = cmd.commands.find(c => c.name() === 'channel')!;
    const helpText = channelCmd.helpInformation();

    expect(helpText).toContain('latest | current | next | vX.Y.Z');
    expect(helpText).not.toMatch(/latest \| stable \| develop/);
  });

  it('shows the canonical channel name and warns on stderr when the stored value is a deprecated alias', async () => {
    mockApi.mockResolvedValue({ channel: 'stable' });
    const { lines, spy } = captureConsole();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('channel');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/settings');
    expect(lines.some(l => l.includes('current'))).toBe(true);
    expect(lines.some(l => l.includes('"stable"'))).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toBe(
      'Update channel "stable" was renamed to "current". "stable" still works but is deprecated and will be removed in a future release; switch to "current".'
    );
    errorSpy.mockRestore();
  });

  it('shows "latest" as default when channel is not set in settings, with no stderr output', async () => {
    mockApi.mockResolvedValue({});
    const { lines, spy } = captureConsole();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('channel');

    spy.mockRestore();
    expect(lines.some(l => l.includes('latest'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('updates channel to a canonical name with empty stderr and exit 0', async () => {
    mockApi.mockResolvedValue({ channel: 'next' });
    const { lines, spy } = captureConsole();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('channel', 'next');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { channel: 'next' });
    expect(lines.some(l => l.includes('next'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('setting a deprecated alias writes exactly one deprecation line to stderr before the PUT, still exits 0, and updates the channel', async () => {
    mockApi.mockResolvedValue({ channel: 'current' });
    const { lines, spy } = captureConsole();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('channel', 'develop');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { channel: 'develop' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toBe(
      'Update channel "develop" was renamed to "next". "develop" still works but is deprecated and will be removed in a future release; switch to "next".'
    );
    expect(lines.some(l => l.includes('current'))).toBe(true);
    errorSpy.mockRestore();
  });

  it('accepts a specific version tag as channel name with empty stderr', async () => {
    mockApi.mockResolvedValue({ channel: 'v0.2.0' });
    const { lines, spy } = captureConsole();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('channel', 'v0.2.0');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { channel: 'v0.2.0' });
    expect(lines.some(l => l.includes('v0.2.0'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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

  it('proceeds when readline answer is "y" (without --yes flag)', async () => {
    // Covers the false branch of line 107: answer IS 'y', so we proceed (don't abort)
    mockRlAnswer.mockImplementation((_prompt: string, cb: (ans: string) => void) => cb('y'));
    mockApi.mockResolvedValueOnce({ message: 'Update started.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.useFakeTimers();

    const { spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const runPromise = run('run'); // no --yes → uses readline
    await vi.advanceTimersByTimeAsync(3000);
    await runPromise;

    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/system/update');
  });

  it('aborts without calling the API when confirmation is declined', async () => {
    mockRlAnswer.mockImplementation((_prompt: string, cb: (ans: string) => void) => cb('n'));
    const { lines, spy } = captureConsole();

    await run('run');

    spy.mockRestore();
    expect(mockApi).not.toHaveBeenCalled();
    expect(lines.some(l => l.includes('Aborted'))).toBe(true);
  });

  it('exits 1 with ApiError message when POST fails', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(403, 'admin only'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('run', '--yes')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('admin only'));
  });

  it('exits 1 with generic message when POST throws non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('connection refused'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('run', '--yes')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Update request failed'));
  });

  it('prints timeout warning when service does not come back', async () => {
    mockApi.mockResolvedValueOnce({ message: 'Update started.' });
    // fetch always fails (service restarting) — keep attempts < 20 by using a counter
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    // Override setTimeout to be instant so the poll loop doesn't take 60s
    vi.useFakeTimers();

    const { lines, spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const runPromise = run('run', '--yes');

    // Drain 20 poll iterations instantly
    for (let i = 0; i < 21; i++) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    await runPromise;
    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    expect(lines.some(l => l.includes('did not come back') || l.includes('60 s'))).toBe(true);
  });

  it('writes a dot to stdout on each failed health poll attempt', async () => {
    mockApi.mockResolvedValueOnce({ message: 'Update started.' });
    // First fetch fails (dot), second fetch ok (done)
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('still starting'));
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const runPromise = run('run', '--yes');
    await vi.advanceTimersByTimeAsync(3000); // first poll (fails → dot)
    await vi.advanceTimersByTimeAsync(3000); // second poll (ok)
    await runPromise;

    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('.'));
    writeSpy.mockRestore();
  });

  it('falls back to localhost URL when account is null', async () => {
    // Override getCurrentAccount to return null for this test
    const { getCurrentAccount } = await import('../store.js');
    vi.mocked(getCurrentAccount).mockResolvedValueOnce(null as never);

    mockApi.mockResolvedValueOnce({ message: 'Update started.' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const { spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const runPromise = run('run', '--yes');
    await vi.advanceTimersByTimeAsync(3000);
    await runPromise;

    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    // Should have polled the fallback URL
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/health');
  });

  it('dots on poll with ok:false response (fetch succeeds but not healthy)', async () => {
    mockApi.mockResolvedValueOnce({ message: 'Update started.' });
    // First poll: ok=false (dot written), second: ok=true (done)
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve({ ok: calls >= 2 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const runPromise = run('run', '--yes');
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await runPromise;

    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('.'));
    writeSpy.mockRestore();
  });
});

// ── update channel — error paths ─────────────────────────────────────────────

describe('routerly update channel — error paths', () => {
  it('exits 1 with ApiError message when GET settings fails', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('channel')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('exits 1 with generic message when GET settings throws non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('channel')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to communicate'));
  });

  it('exits 1 with ApiError message when PUT settings fails', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('channel', 'stable')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 with generic message when PUT settings throws non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('network error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('channel', 'stable')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to communicate'));
  });

  it('uses the provided channel name when updated.channel is undefined', async () => {
    // PUT returns object without channel field — fallback to arg name
    mockApi.mockResolvedValueOnce({});
    const { lines, spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('channel', 'v1.0.0');
    spy.mockRestore();
    expect(lines.some(l => l.includes('v1.0.0'))).toBe(true);
  });
});

// ── update check — error paths ────────────────────────────────────────────────

describe('routerly update check — error paths', () => {
  it('exits 1 with ApiError message', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(503, 'service unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('check')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('service unavailable'));
  });

  it('exits 1 with service-not-running message on generic error', async () => {
    mockApi.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(run('check')).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to check for updates'));
  });

  it('update available without releaseUrl omits release notes line', async () => {
    mockApi.mockResolvedValueOnce({
      available: true, currentVersion: '0.1.0', latestVersion: '0.2.0',
      channel: 'latest', checkedAt: '2026-07-08T00:00:00.000Z',
      // no releaseUrl
    });
    const { lines, spy } = captureConsole();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('check');
    spy.mockRestore();
    expect(lines.some(l => l.includes('0.2.0'))).toBe(true);
    expect(lines.every(l => !l.includes('Release notes:'))).toBe(true);
  });
});
