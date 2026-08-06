import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

// ── Mock node:child_process (binary probe + launch) before importing ───────

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

// ── Mock ../store.js (account lookups) before importing ────────────────────

const { mockGetCurrentAccount, mockRequireAccount } = vi.hoisted(() => ({
  mockGetCurrentAccount: vi.fn(),
  mockRequireAccount: vi.fn(),
}));

vi.mock('../store.js', () => ({
  getCurrentAccount: mockGetCurrentAccount,
  requireAccount: mockRequireAccount,
}));

import { claudeCodeIntegration } from './claude-code.js';
import { listBackups } from '../lib/safe-file.js';

const ORIGINAL_HOME = process.env.HOME;
let fakeHome: string;

// By default, no `claude` binary on PATH; individual tests override this.
function binaryMissing(): void {
  mockExecFile.mockImplementation((_file: string, _args: string[], cb: (err: Error) => void) => {
    cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

function binaryFound(version = '1.2.3 (Claude Code)'): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], cb: (err: null, res: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: version, stderr: '' });
    }
  );
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'routerly-claude-code-test-'));
  process.env.HOME = fakeHome;
  mockGetCurrentAccount.mockReset().mockResolvedValue(null);
  mockRequireAccount.mockReset();
  mockExecFile.mockReset();
  mockSpawn.mockReset();
  binaryMissing();
});

afterEach(async () => {
  process.env.HOME = ORIGINAL_HOME;
  await rm(fakeHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function configPath(): string {
  return join(fakeHome, '.claude', 'settings.json');
}

// ── detect ───────────────────────────────────────────────────────────────

describe('detect', () => {
  it('reports not installed when neither settings file nor binary are present', async () => {
    const result = await claudeCodeIntegration.detect();
    expect(result).toEqual({
      installed: false,
      configPath: configPath(),
      configExists: false,
      version: undefined,
    });
  });

  it('reports installed via presence of the settings file alone', async () => {
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(configPath(), '{}', 'utf-8');

    const result = await claudeCodeIntegration.detect();
    expect(result.installed).toBe(true);
    expect(result.configExists).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it('reports installed via presence of the binary alone, and captures version', async () => {
    binaryFound('1.2.3 (Claude Code)');

    const result = await claudeCodeIntegration.detect();
    expect(result.installed).toBe(true);
    expect(result.configExists).toBe(false);
    expect(result.version).toBe('1.2.3 (Claude Code)');
  });
});

// ── plan / apply / rollback ─────────────────────────────────────────────

describe('plan + apply', () => {
  it('plan merges an env block with ANTHROPIC_BASE_URL (root, no /v1) and ANTHROPIC_AUTH_TOKEN', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);

    expect(plan.clientId).toBe('claude-code');
    expect(plan.filePath).toBe(configPath());
    expect(plan.before).toBe('');
    expect(plan.backupId).toBeTruthy();

    const parsed = JSON.parse(plan.after);
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://routerly.example.com');
    expect(parsed.env.ANTHROPIC_BASE_URL).not.toContain('/v1');
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-rt-test');
  });

  it('plan never clobbers unrelated keys in an existing settings file', async () => {
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({ theme: 'dark', env: { SOME_OTHER_VAR: 'keep-me' } }, null, 2),
      'utf-8'
    );

    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);

    const parsed = JSON.parse(plan.after);
    expect(parsed.theme).toBe('dark');
    expect(parsed.env.SOME_OTHER_VAR).toBe('keep-me');
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://routerly.example.com');
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-rt-test');
  });

  it('plan is idempotent: applying then re-planning with the same target yields identical after', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const first = await claudeCodeIntegration.plan(target);
    await claudeCodeIntegration.apply(first);

    const second = await claudeCodeIntegration.plan(target);
    expect(second.after).toBe(first.after);
  });

  it('apply writes via atomicWrite and returns a backupId restorable by rollback', async () => {
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(configPath(), JSON.stringify({ theme: 'dark' }, null, 2), 'utf-8');
    const before = await readFile(configPath(), 'utf-8');

    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);
    const result = await claudeCodeIntegration.apply(plan);

    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(configPath());
    expect(result.backupId).toBe(plan.backupId);

    const applied = await readFile(configPath(), 'utf-8');
    expect(applied).toBe(plan.after);
    expect(applied).not.toBe(before);

    // No leftover .<pid>.tmp sibling from atomicWrite.
    const backups = await listBackups();
    expect(backups.some((b) => b.backupId === plan.backupId)).toBe(true);

    await claudeCodeIntegration.rollback(plan.backupId);
    const restored = await readFile(configPath(), 'utf-8');
    expect(restored).toBe(before);
  });

  it('apply creates the ~/.claude directory when it does not exist yet', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);
    const result = await claudeCodeIntegration.apply(plan);

    expect(result.ok).toBe(true);
    const applied = await readFile(configPath(), 'utf-8');
    expect(applied).toBe(plan.after);
  });
});

// ── inspect ──────────────────────────────────────────────────────────────

describe('inspect', () => {
  it('reports not configured when the settings file does not exist', async () => {
    const result = await claudeCodeIntegration.inspect();
    expect(result).toEqual({
      configPath: configPath(),
      exists: false,
      routerlyConfigured: false,
      currentBaseUrl: undefined,
      stale: false,
    });
  });

  it('flags routerlyConfigured true after apply', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);
    await claudeCodeIntegration.apply(plan);

    const result = await claudeCodeIntegration.inspect();
    expect(result.exists).toBe(true);
    expect(result.routerlyConfigured).toBe(true);
    expect(result.currentBaseUrl).toBe('https://routerly.example.com');
  });

  it('flags stale when the configured base URL points elsewhere than the active account', async () => {
    const target = { baseUrl: 'https://old.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);
    await claudeCodeIntegration.apply(plan);

    mockGetCurrentAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'https://new.example.com',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await claudeCodeIntegration.inspect();
    expect(result.routerlyConfigured).toBe(true);
    expect(result.stale).toBe(true);
  });

  it('is not stale when the configured base URL matches the active account', async () => {
    const target = { baseUrl: 'https://match.example.com', token: 'sk-rt-test', wireFormat: 'anthropic' as const };
    const plan = await claudeCodeIntegration.plan(target);
    await claudeCodeIntegration.apply(plan);

    mockGetCurrentAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'https://match.example.com',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await claudeCodeIntegration.inspect();
    expect(result.stale).toBe(false);
  });
});

// ── validate ─────────────────────────────────────────────────────────────

describe('validate', () => {
  it('reports reachable when the service responds ok', async () => {
    mockRequireAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'http://localhost:3000',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const result = await claudeCodeIntegration.validate();
    expect(result).toEqual({
      ok: true,
      reachable: true,
      message: 'Routerly service reachable at http://localhost:3000',
    });
  });

  it('reports unreachable when fetch throws', async () => {
    mockRequireAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'http://localhost:3000',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await claudeCodeIntegration.validate();
    expect(result.ok).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('reports not ok when the service responds with a non-2xx status', async () => {
    mockRequireAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'http://localhost:3000',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await claudeCodeIntegration.validate();
    expect(result.ok).toBe(false);
    expect(result.reachable).toBe(true);
    expect(result.message).toContain('503');
  });
});

// ── launch ───────────────────────────────────────────────────────────────

describe('launch', () => {
  it('throws when the claude binary is not installed', async () => {
    await expect(claudeCodeIntegration.launch!()).rejects.toThrow(/not installed/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns the claude binary when installed', async () => {
    binaryFound();
    mockSpawn.mockImplementation(() => {
      const ee = new EventEmitter();
      queueMicrotask(() => ee.emit('exit', 0));
      return ee;
    });

    await claudeCodeIntegration.launch!();
    expect(mockSpawn).toHaveBeenCalledWith('claude', [], { stdio: 'inherit' });
  });
});
