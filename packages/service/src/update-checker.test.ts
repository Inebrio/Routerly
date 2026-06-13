import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock node:https before importing the module under test ───────────────────

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock('node:https', () => ({ request: mockRequest }));

import { UpdateChecker } from './update-checker.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MockRes extends EventEmitter {
  statusCode: number;
}

type ReqLike = EventEmitter & { end: () => void; destroy: () => void };

function stubGithubOk(body: object): void {
  mockRequest.mockImplementation((_opts: unknown, cb: (res: MockRes) => void) => {
    const req = new EventEmitter() as ReqLike;
    req.end = () => {
      const res = new EventEmitter() as MockRes;
      res.statusCode = 200;
      cb(res);
      res.emit('data', Buffer.from(JSON.stringify(body)));
      res.emit('end');
    };
    req.destroy = () => {};
    return req;
  });
}

function stubGithubError(): void {
  mockRequest.mockImplementation((_opts: unknown, _cb: unknown) => {
    const req = new EventEmitter() as ReqLike;
    req.end = () => { req.emit('error', new Error('Network failure')); };
    req.destroy = () => {};
    return req;
  });
}

function stubGithubNotFound(): void {
  mockRequest.mockImplementation((_opts: unknown, cb: (res: MockRes) => void) => {
    const req = new EventEmitter() as ReqLike;
    req.end = () => {
      const res = new EventEmitter() as MockRes;
      res.statusCode = 404;
      cb(res);
      res.emit('data', Buffer.from('Not Found'));
      res.emit('end');
    };
    req.destroy = () => {};
    return req;
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

let checker: UpdateChecker;

beforeEach(() => {
  checker = new UpdateChecker();
});

afterEach(() => {
  vi.clearAllMocks();
  checker.stop();
});

describe('UpdateChecker.check()', () => {
  it('returns available=true when GitHub reports a newer version', async () => {
    stubGithubOk({
      tag_name: 'v1.0.0',
      html_url: 'https://github.com/Inebrio/Routerly/releases/tag/v1.0.0',
      prerelease: false,
    });

    checker.start('0.1.5', 'latest');
    const result = await checker.check();

    expect(result.available).toBe(true);
    expect(result.currentVersion).toBe('0.1.5');
    expect(result.latestVersion).toBe('1.0.0');
    expect(result.channel).toBe('latest');
    expect(result.releaseUrl).toBe('https://github.com/Inebrio/Routerly/releases/tag/v1.0.0');
    expect(result.checkedAt).toBeTruthy();
  });

  it('returns available=false when already on the latest version', async () => {
    stubGithubOk({ tag_name: 'v0.1.5', html_url: '', prerelease: false });

    checker.start('0.1.5', 'latest');
    const result = await checker.check();

    expect(result.available).toBe(false);
    expect(result.latestVersion).toBe('0.1.5');
  });

  it('returns available=false when running newer than the channel tag', async () => {
    stubGithubOk({ tag_name: 'v0.1.4', html_url: '', prerelease: false });

    checker.start('0.1.5', 'stable');
    const result = await checker.check();

    expect(result.available).toBe(false);
  });

  it('strips leading "v" from tag_name in latestVersion', async () => {
    stubGithubOk({ tag_name: 'v2.0.0', html_url: '', prerelease: false });

    checker.start('0.1.5', 'latest');
    const result = await checker.check();

    expect(result.latestVersion).toBe('2.0.0');
  });

  it('uses tag_name as-is when it has no leading "v"', async () => {
    stubGithubOk({ tag_name: '2.0.0', html_url: 'https://example.com', prerelease: false });

    checker.start('0.1.5', 'latest');
    const result = await checker.check();

    expect(result.latestVersion).toBe('2.0.0');
    expect(result.available).toBe(true);
  });

  it('returns available=false when candidate has a lower major version (isNewer branch)', async () => {
    stubGithubOk({ tag_name: 'v0.0.1', html_url: '', prerelease: false });

    checker.start('1.0.0', 'stable');
    const result = await checker.check();

    expect(result.available).toBe(false);
  });

  it('returns available=false for non-semver tag names (parseSemver returns null)', async () => {
    stubGithubOk({ tag_name: 'not-a-version', html_url: '', prerelease: false });

    checker.start('0.1.5', 'latest');
    const result = await checker.check();

    expect(result.available).toBe(false);
  });

  it('keeps existing cached result when a subsequent check fails', async () => {
    // First successful check populates the cache
    stubGithubOk({ tag_name: 'v1.0.0', html_url: 'https://example.com', prerelease: false });
    checker.start('0.1.5', 'latest');
    const first = await checker.check();
    expect(first.latestVersion).toBe('1.0.0');

    // Second check fails — cached result should be preserved (not overwritten by fallback)
    stubGithubError();
    const second = await checker.check();
    expect(second.latestVersion).toBe('1.0.0');
    expect(checker.getLastResult()!.latestVersion).toBe('1.0.0');
  });

  it('swallows network errors and returns safe fallback', async () => {
    stubGithubError();

    checker.start('0.1.5', 'latest');
    const result = await checker.check();

    expect(result.available).toBe(false);
    expect(result.currentVersion).toBe('0.1.5');
    expect(result.latestVersion).toBe('0.1.5');
  });

  it('swallows non-200 GitHub responses and returns safe fallback', async () => {
    stubGithubNotFound();

    checker.start('0.1.5', 'stable');
    const result = await checker.check();

    expect(result.available).toBe(false);
  });
});

describe('UpdateChecker.getLastResult()', () => {
  it('returns null before any check has completed', () => {
    expect(checker.getLastResult()).toBeNull();
  });

  it('returns the cached result after a successful check', async () => {
    stubGithubOk({ tag_name: 'v1.0.0', html_url: '', prerelease: false });

    checker.start('0.1.5', 'latest');
    await checker.check();

    const cached = checker.getLastResult();
    expect(cached).not.toBeNull();
    expect(cached!.latestVersion).toBe('1.0.0');
  });
});

describe('UpdateChecker.start() with empty channel', () => {
  it('defaults channel to "latest" when an empty string is passed', async () => {
    stubGithubOk({ tag_name: 'v1.0.0', html_url: '', prerelease: false });
    checker.start('0.1.5', '');
    const result = await checker.check();
    expect(result.channel).toBe('latest');
  });
});

describe('UpdateChecker.updateChannel()', () => {
  it('changes the channel used for subsequent checks', async () => {
    // First check on "latest"
    stubGithubOk({ tag_name: 'v1.0.0', html_url: '', prerelease: false });
    checker.start('0.1.5', 'latest');
    await checker.check();

    // Switch to "stable"; use a tag older than the current version
    updateChecker: checker.updateChannel('stable');
    stubGithubOk({ tag_name: 'v0.1.0', html_url: '', prerelease: false });
    const result = await checker.check();

    expect(result.channel).toBe('stable');
    expect(result.available).toBe(false); // 0.1.0 < 0.1.5
  });

  it('does not update the cached result until the next check runs', async () => {
    stubGithubOk({ tag_name: 'v1.0.0', html_url: '', prerelease: false });
    checker.start('0.1.5', 'latest');
    await checker.check();

    const before = checker.getLastResult();
    checker.updateChannel('develop');
    const after = checker.getLastResult();

    // Cached result channel is unchanged until next check
    expect(before?.channel).toBe(after?.channel);
  });

  it('defaults to "latest" when empty string is passed to updateChannel', async () => {
    stubGithubOk({ tag_name: 'v1.0.0', html_url: '', prerelease: false });
    checker.start('0.1.5', 'latest');
    checker.updateChannel('');
    const result = await checker.check();
    expect(result.channel).toBe('latest');
  });
});

describe('UpdateChecker.start() idempotency', () => {
  it('creates only one interval timer even if called multiple times', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    stubGithubOk({ tag_name: 'v0.1.5', html_url: '', prerelease: false });
    checker.start('0.1.5', 'latest');
    checker.start('0.1.5', 'latest');
    checker.start('0.1.5', 'latest');

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });
});

describe('UpdateChecker.getAvailableReleases()', () => {
  it('returns base channels when GitHub API fails', async () => {
    stubGithubError();
    checker.start('0.1.5', 'latest');
    const result = await checker.getAvailableReleases();
    expect(result.channels).toContain('latest');
    expect(result.channels).toContain('stable');
  });

  it('returns base channels plus extra non-semver tags from GitHub', async () => {
    stubGithubOk([
      { tag_name: 'beta-2', draft: false, prerelease: true },
      { tag_name: 'v0.1.5', draft: false, prerelease: false },
      { tag_name: 'nightly', draft: false, prerelease: false },
      { tag_name: 'draft-only', draft: true, prerelease: false },
    ]);

    // Do NOT call start() — it fires check() which would consume the first mock call
    const result = await checker.getAvailableReleases();
    expect(result.channels).toContain('nightly')
    // v0.1.5 is a semver tag so not added as extra channel
    expect(result.channels).not.toContain('v0.1.5')
    // draft-only is skipped
    expect(result.channels).not.toContain('draft-only')
  });

  it('falls back to base channels when fetchAllReleases returns invalid JSON', async () => {
    mockRequest.mockImplementation((_opts: unknown, cb: (res: MockRes) => void) => {
      const req = new EventEmitter() as ReqLike;
      req.end = () => {
        const res = new EventEmitter() as MockRes;
        res.statusCode = 200;
        cb(res);
        res.emit('data', Buffer.from('{{{invalid-json'));
        res.emit('end');
      };
      req.destroy = () => {};
      return req;
    });

    const result = await checker.getAvailableReleases();
    expect(result.channels).toEqual(['latest', 'stable', 'develop']);
  });
});

describe('UpdateChecker.check() JSON parse error', () => {
  it('handles JSON parse error gracefully', async () => {
    mockRequest.mockImplementation((_opts: unknown, cb: (res: MockRes) => void) => {
      const req = new EventEmitter() as ReqLike;
      req.end = () => {
        const res = new EventEmitter() as MockRes;
        res.statusCode = 200;
        cb(res);
        res.emit('data', Buffer.from('not-valid-json-{{{'));
        res.emit('end');
      };
      req.destroy = () => {};
      return req;
    });

    checker.start('0.1.5', 'latest');
    const result = await checker.check();
    // Should return fallback on JSON parse error
    expect(result.available).toBe(false);
  });
});

describe('UpdateChecker.stop()', () => {
  it('clears the interval timer', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    stubGithubOk({ tag_name: 'v0.1.5', html_url: '', prerelease: false });
    checker.start('0.1.5', 'latest');
    checker.stop();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('is idempotent when called multiple times', () => {
    checker.stop();
    checker.stop();
    // Should not throw
  });
});

describe('UpdateChecker — remaining uncovered branches', () => {
  it('isNewer returns true when candidate has higher minor version (line 35 true branch)', async () => {
    stubGithubOk({ tag_name: 'v0.2.0', html_url: 'http://x.com', prerelease: false });
    checker.start('0.1.5', 'latest');
    const result = await checker.check();
    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('0.2.0');
  });

  it('rejects when GitHub API returns non-200 status (line 65 false branch)', async () => {
    mockRequest.mockImplementation((_opts: unknown, cb: (res: MockRes) => void) => {
      const req = new EventEmitter() as ReqLike;
      req.end = () => {
        const res = new EventEmitter() as MockRes;
        res.statusCode = 404;
        cb(res);
        res.emit('end');
      };
      req.destroy = () => {};
      return req;
    });
    checker.start('0.1.5', 'latest');
    const result = await checker.check();
    // Error from non-200 → check returns false (not available)
    expect(result.available).toBe(false);
  });

  it('does not create a second timer when start() is called twice (line 139 false branch)', () => {
    stubGithubOk([{ tag_name: 'v0.1.5', html_url: '', prerelease: false, draft: false }]);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    checker.start('0.1.5', 'latest');
    checker.start('0.1.5', 'latest');
    // Timer should only be created once
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it('getAvailableReleases: non-200 response from fetchReleaseList → falls back to base channels (line 70)', async () => {
    mockRequest.mockImplementation((_opts: unknown, cb: (res: MockRes) => void) => {
      const req = new EventEmitter() as ReqLike;
      req.end = () => {
        const res = new EventEmitter() as MockRes;
        res.statusCode = 403;
        cb(res);
        res.emit('data', Buffer.from('Forbidden'));
        res.emit('end');
      };
      req.destroy = () => {};
      return req;
    });
    checker.start('0.1.5', 'latest');
    const result = await checker.getAvailableReleases();
    expect(result.channels).toContain('latest');
    expect(result.channels).toContain('stable');
  });

  it('setInterval callback fires and triggers a check (line 137 function)', async () => {
    stubGithubOk({ tag_name: 'v0.2.0', html_url: '', prerelease: false });
    vi.useFakeTimers();
    checker.start('0.1.5', 'latest');
    // Advance past CHECK_INTERVAL_MS to trigger the setInterval callback
    await vi.advanceTimersByTimeAsync(3_700_000);
    vi.useRealTimers();
    // The setInterval callback called check() — verify the result was fetched
    expect(checker.getLastResult()).not.toBeNull();
  });

  it('fetchRelease timeout → rejects with timeout error (line 76 function)', async () => {
    mockRequest.mockImplementation((_opts: unknown, _cb: unknown) => {
      const req = new EventEmitter() as ReqLike;
      req.end = () => { req.emit('timeout'); };
      req.destroy = vi.fn();
      return req;
    });
    checker.start('0.1.5', 'latest');
    const result = await checker.check();
    // timeout → error caught → fallback result
    expect(result.available).toBe(false);
  });
});
