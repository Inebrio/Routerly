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
