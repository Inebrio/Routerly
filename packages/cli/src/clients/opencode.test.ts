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

import { opencodeIntegration } from './opencode.js';
import { listBackups } from '../lib/safe-file.js';

const ORIGINAL_HOME = process.env.HOME;
let fakeHome: string;

// By default, no `opencode` binary on PATH; individual tests override this.
function binaryMissing(): void {
  mockExecFile.mockImplementation((_file: string, _args: string[], cb: (err: Error) => void) => {
    cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

function binaryFound(version = '1.2.3'): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], cb: (err: null, res: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: version, stderr: '' });
    }
  );
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'routerly-opencode-test-'));
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
  return join(fakeHome, '.config', 'opencode', 'opencode.json');
}

// ── detect ───────────────────────────────────────────────────────────────

describe('detect', () => {
  it('reports not installed when neither config file nor binary are present', async () => {
    const result = await opencodeIntegration.detect();
    expect(result).toEqual({
      installed: false,
      configPath: configPath(),
      configExists: false,
      version: undefined,
    });
  });

  it('reports installed via presence of the config file alone', async () => {
    await mkdir(join(fakeHome, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath(), '{}', 'utf-8');

    const result = await opencodeIntegration.detect();
    expect(result.installed).toBe(true);
    expect(result.configExists).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it('reports installed via presence of the binary alone, and captures version', async () => {
    binaryFound('1.2.3');

    const result = await opencodeIntegration.detect();
    expect(result.installed).toBe(true);
    expect(result.configExists).toBe(false);
    expect(result.version).toBe('1.2.3');
  });
});

// ── plan / apply / rollback ─────────────────────────────────────────────

describe('plan + apply', () => {
  it('plan writes a routerly provider entry with options.baseURL = <serverUrl>/v1 and the literal apiKey', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);

    expect(plan.clientId).toBe('opencode');
    expect(plan.filePath).toBe(configPath());
    expect(plan.before).toBe('');
    expect(plan.backupId).toBeTruthy();

    const parsed = JSON.parse(plan.after);
    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.provider.routerly.npm).toBe('@ai-sdk/openai-compatible');
    expect(parsed.provider.routerly.name).toBe('Routerly');
    expect(parsed.provider.routerly.options.baseURL).toBe('https://routerly.example.com/v1');
    expect(parsed.provider.routerly.options.apiKey).toBe('sk-rt-test');
    expect(parsed.provider.routerly.models).toHaveProperty('routerly/ada');
    // apiKey must be a literal string, never an `{env:VAR}` reference: that
    // would require a manual export step, breaking the auto-configurable
    // promise.
    expect(plan.after).not.toContain('{env:');
  });

  it('plan never clobbers unrelated top-level keys or other providers in an existing opencode.json', async () => {
    await mkdir(join(fakeHome, '.config', 'opencode'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({ theme: 'dark', provider: { anthropic: { options: { apiKey: 'keep-me' } } } }, null, 2),
      'utf-8'
    );

    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);

    const parsed = JSON.parse(plan.after);
    expect(parsed.theme).toBe('dark');
    expect(parsed.provider.anthropic.options.apiKey).toBe('keep-me');
    expect(parsed.provider.routerly.options.baseURL).toBe('https://routerly.example.com/v1');
  });

  it('plan is idempotent: applying then re-planning with the same target yields identical after', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const first = await opencodeIntegration.plan(target);
    await opencodeIntegration.apply(first);

    const second = await opencodeIntegration.plan(target);
    expect(second.after).toBe(first.after);
  });

  it('re-planning after apply with a different target replaces the routerly block without duplicating it', async () => {
    const first = await opencodeIntegration.plan({
      baseUrl: 'https://old.example.com',
      token: 'sk-rt-old',
      wireFormat: 'openai' as const,
    });
    await opencodeIntegration.apply(first);

    const second = await opencodeIntegration.plan({
      baseUrl: 'https://new.example.com',
      token: 'sk-rt-new',
      wireFormat: 'openai' as const,
    });

    const parsed = JSON.parse(second.after);
    expect(Object.keys(parsed.provider)).toEqual(['routerly']);
    expect(parsed.provider.routerly.options.baseURL).toBe('https://new.example.com/v1');
    expect(second.after).not.toContain('old.example.com');
    expect(second.after).not.toContain('sk-rt-old');
  });

  it('apply writes via atomicWrite and returns a backupId restorable by rollback', async () => {
    await mkdir(join(fakeHome, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath(), JSON.stringify({ theme: 'dark' }, null, 2), 'utf-8');
    const before = await readFile(configPath(), 'utf-8');

    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);
    const result = await opencodeIntegration.apply(plan);

    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(configPath());
    expect(result.backupId).toBe(plan.backupId);

    const applied = await readFile(configPath(), 'utf-8');
    expect(applied).toBe(plan.after);
    expect(applied).not.toBe(before);

    const backups = await listBackups();
    expect(backups.some((b) => b.backupId === plan.backupId)).toBe(true);

    await opencodeIntegration.rollback(plan.backupId);
    const restored = await readFile(configPath(), 'utf-8');
    expect(restored).toBe(before);
  });

  it('apply creates the ~/.config/opencode directory when it does not exist yet', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);
    const result = await opencodeIntegration.apply(plan);

    expect(result.ok).toBe(true);
    const applied = await readFile(configPath(), 'utf-8');
    expect(applied).toBe(plan.after);
  });
});

// ── inspect ──────────────────────────────────────────────────────────────

describe('inspect', () => {
  it('reports not configured when the config file does not exist', async () => {
    const result = await opencodeIntegration.inspect();
    expect(result).toEqual({
      configPath: configPath(),
      exists: false,
      routerlyConfigured: false,
      currentBaseUrl: undefined,
      stale: false,
    });
  });

  it('flags routerlyConfigured true after apply', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);
    await opencodeIntegration.apply(plan);

    const result = await opencodeIntegration.inspect();
    expect(result.exists).toBe(true);
    expect(result.routerlyConfigured).toBe(true);
    expect(result.currentBaseUrl).toBe('https://routerly.example.com/v1');
  });

  it('flags stale when the configured base URL points elsewhere than the active account', async () => {
    const target = { baseUrl: 'https://old.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);
    await opencodeIntegration.apply(plan);

    mockGetCurrentAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'https://new.example.com',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await opencodeIntegration.inspect();
    expect(result.routerlyConfigured).toBe(true);
    expect(result.stale).toBe(true);
  });

  it('is not stale when the configured base URL matches the active account', async () => {
    const target = { baseUrl: 'https://match.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await opencodeIntegration.plan(target);
    await opencodeIntegration.apply(plan);

    mockGetCurrentAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'https://match.example.com',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await opencodeIntegration.inspect();
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

    const result = await opencodeIntegration.validate();
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

    const result = await opencodeIntegration.validate();
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

    const result = await opencodeIntegration.validate();
    expect(result.ok).toBe(false);
    expect(result.reachable).toBe(true);
    expect(result.message).toContain('503');
  });
});

// ── launch ───────────────────────────────────────────────────────────────

describe('launch', () => {
  it('throws when the opencode binary is not installed', async () => {
    await expect(opencodeIntegration.launch!()).rejects.toThrow(/not installed/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns the opencode binary when installed', async () => {
    binaryFound();
    mockSpawn.mockImplementation(() => {
      const ee = new EventEmitter();
      queueMicrotask(() => ee.emit('exit', 0));
      return ee;
    });

    await opencodeIntegration.launch!();
    expect(mockSpawn).toHaveBeenCalledWith('opencode', [], { stdio: 'inherit' });
  });
});
