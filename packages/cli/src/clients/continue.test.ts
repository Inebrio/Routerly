import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mock node:child_process (binary/extension probe) before importing ──────

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
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

import { continueIntegration, clineIntegration } from './continue.js';
import { listBackups } from '../lib/safe-file.js';

const ORIGINAL_HOME = process.env.HOME;
let fakeHome: string;

function extensionMissing(): void {
  mockExecFile.mockImplementation((_file: string, _args: string[], cb: (err: Error) => void) => {
    cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

function extensionListed(ids: string[]): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], cb: (err: null, res: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: ids.join('\n'), stderr: '' });
    }
  );
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'routerly-continue-test-'));
  process.env.HOME = fakeHome;
  mockGetCurrentAccount.mockReset().mockResolvedValue(null);
  mockRequireAccount.mockReset();
  mockExecFile.mockReset();
  extensionMissing();
});

afterEach(async () => {
  process.env.HOME = ORIGINAL_HOME;
  await rm(fakeHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function configPath(): string {
  return join(fakeHome, '.continue', 'config.yaml');
}

// ── detect ───────────────────────────────────────────────────────────────

describe('continueIntegration.detect', () => {
  it('reports not installed when the config file is absent', async () => {
    const result = await continueIntegration.detect();
    expect(result).toEqual({
      installed: false,
      configPath: configPath(),
      configExists: false,
    });
  });

  it('reports installed via presence of the config file', async () => {
    await mkdir(join(fakeHome, '.continue'), { recursive: true });
    await writeFile(configPath(), 'name: x\nversion: 0.0.1\nschema: v1\n', 'utf-8');

    const result = await continueIntegration.detect();
    expect(result.installed).toBe(true);
    expect(result.configExists).toBe(true);
  });
});

// ── plan / apply / rollback ─────────────────────────────────────────────

describe('continueIntegration.plan + apply', () => {
  it('plan writes a models entry with apiBase = <serverUrl>/v1 and the literal apiKey, on a fresh file', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await continueIntegration.plan(target);

    expect(plan.clientId).toBe('continue');
    expect(plan.filePath).toBe(configPath());
    expect(plan.before).toBe('');
    expect(plan.backupId).toBeTruthy();

    const lines = plan.after.split('\n');
    expect(lines).toContain('name: Routerly');
    expect(lines).toContain('version: 0.0.1');
    expect(lines).toContain('schema: v1');
    expect(lines).toContain('models:');
    expect(lines).toContain('  - name: Routerly (auto-routed)');
    expect(lines).toContain('    provider: openai');
    expect(lines).toContain('    model: routerly/ada');
    expect(lines).toContain('    apiBase: https://routerly.example.com/v1');
    expect(lines).toContain('    apiKey: sk-rt-test');
    // apiKey must be a literal string, never a secret-reference syntax.
    expect(plan.after).not.toContain('{{');
  });

  it('plan never clobbers unrelated header keys or sibling models entries in an existing config.yaml', async () => {
    await mkdir(join(fakeHome, '.continue'), { recursive: true });
    await writeFile(
      configPath(),
      [
        'name: My Config',
        'version: 1.2.3',
        'schema: v1',
        '',
        'models:',
        '  - name: GPT-4o',
        '    provider: openai',
        '    model: gpt-4o',
        '    apiKey: keep-me',
        '',
      ].join('\n'),
      'utf-8'
    );

    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await continueIntegration.plan(target);
    const lines = plan.after.split('\n');

    expect(lines).toContain('name: My Config');
    expect(lines).toContain('version: 1.2.3');
    expect(lines).toContain('  - name: GPT-4o');
    expect(lines).toContain('    apiKey: keep-me');
    expect(lines).toContain('    apiBase: https://routerly.example.com/v1');
  });

  it('plan is idempotent: applying then re-planning with the same target yields identical after', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const first = await continueIntegration.plan(target);
    await continueIntegration.apply(first);

    const second = await continueIntegration.plan(target);
    expect(second.after).toBe(first.after);
  });

  it('re-planning after apply with a different target replaces the routerly entry without duplicating it', async () => {
    const first = await continueIntegration.plan({
      baseUrl: 'https://old.example.com',
      token: 'sk-rt-old',
      wireFormat: 'openai' as const,
    });
    await continueIntegration.apply(first);

    const second = await continueIntegration.plan({
      baseUrl: 'https://new.example.com',
      token: 'sk-rt-new',
      wireFormat: 'openai' as const,
    });

    const occurrences = second.after.split('model: routerly/ada').length - 1;
    expect(occurrences).toBe(1);
    expect(second.after).toContain('apiBase: https://new.example.com/v1');
    expect(second.after).not.toContain('old.example.com');
    expect(second.after).not.toContain('sk-rt-old');
  });

  it('apply writes via atomicWrite and returns a backupId restorable by rollback', async () => {
    await mkdir(join(fakeHome, '.continue'), { recursive: true });
    await writeFile(configPath(), 'name: keep\nversion: 0.0.1\nschema: v1\n', 'utf-8');
    const before = await readFile(configPath(), 'utf-8');

    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await continueIntegration.plan(target);
    const result = await continueIntegration.apply(plan);

    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(configPath());
    expect(result.backupId).toBe(plan.backupId);

    const applied = await readFile(configPath(), 'utf-8');
    expect(applied).toBe(plan.after);
    expect(applied).not.toBe(before);

    const backups = await listBackups();
    expect(backups.some((b) => b.backupId === plan.backupId)).toBe(true);

    await continueIntegration.rollback(plan.backupId);
    const restored = await readFile(configPath(), 'utf-8');
    expect(restored).toBe(before);
  });

  it('apply creates the ~/.continue directory when it does not exist yet', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await continueIntegration.plan(target);
    const result = await continueIntegration.apply(plan);

    expect(result.ok).toBe(true);
    const applied = await readFile(configPath(), 'utf-8');
    expect(applied).toBe(plan.after);
  });
});

// ── inspect ──────────────────────────────────────────────────────────────

describe('continueIntegration.inspect', () => {
  it('reports not configured when the config file does not exist', async () => {
    const result = await continueIntegration.inspect();
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
    const plan = await continueIntegration.plan(target);
    await continueIntegration.apply(plan);

    const result = await continueIntegration.inspect();
    expect(result.exists).toBe(true);
    expect(result.routerlyConfigured).toBe(true);
    expect(result.currentBaseUrl).toBe('https://routerly.example.com/v1');
  });

  it('flags stale when the configured base URL points elsewhere than the active account', async () => {
    const target = { baseUrl: 'https://old.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await continueIntegration.plan(target);
    await continueIntegration.apply(plan);

    mockGetCurrentAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'https://new.example.com',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await continueIntegration.inspect();
    expect(result.routerlyConfigured).toBe(true);
    expect(result.stale).toBe(true);
  });

  it('is not stale when the configured base URL matches the active account', async () => {
    const target = { baseUrl: 'https://match.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    const plan = await continueIntegration.plan(target);
    await continueIntegration.apply(plan);

    mockGetCurrentAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'https://match.example.com',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await continueIntegration.inspect();
    expect(result.stale).toBe(false);
  });
});

// ── validate ─────────────────────────────────────────────────────────────

describe('continueIntegration.validate', () => {
  it('reports reachable when the service responds ok', async () => {
    mockRequireAccount.mockResolvedValue({
      alias: 'test',
      serverUrl: 'http://localhost:3000',
      email: 'test@example.com',
      token: 'jwt-test',
      expiresAt: Date.now() + 3_600_000,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const result = await continueIntegration.validate();
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

    const result = await continueIntegration.validate();
    expect(result.ok).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
  });
});

// ── cline (documented, no auto-apply) ───────────────────────────────────

describe('clineIntegration', () => {
  it('is registered as supportState documented', () => {
    expect(clineIntegration.supportState).toBe('documented');
  });

  it('apply always throws a clear "not auto-configurable, see docs" error, regardless of the plan passed in', async () => {
    const fakePlan = {
      clientId: 'cline',
      filePath: '/does/not/matter',
      before: '',
      after: '',
      backupId: 'irrelevant',
    };

    await expect(clineIntegration.apply(fakePlan)).rejects.toThrow(/not auto-configurable/i);
    await expect(clineIntegration.apply(fakePlan)).rejects.toThrow(/docs/i);
  });

  it('plan also throws the same documented-only error, never attempting a file edit', async () => {
    const target = { baseUrl: 'https://routerly.example.com', token: 'sk-rt-test', wireFormat: 'openai' as const };
    await expect(clineIntegration.plan(target)).rejects.toThrow(/not auto-configurable/i);
  });

  it('detect reports installed false when the code binary/extension is not found', async () => {
    const result = await clineIntegration.detect();
    expect(result).toEqual({ installed: false, configPath: null, configExists: false });
  });

  it('detect reports installed true when `code --list-extensions` lists the Cline extension id', async () => {
    extensionListed(['ms-python.python', 'saoudrizwan.claude-dev']);
    const result = await clineIntegration.detect();
    expect(result.installed).toBe(true);
  });

  it('inspect conservatively reports not configured (no file to read)', async () => {
    const result = await clineIntegration.inspect();
    expect(result.exists).toBe(false);
    expect(result.routerlyConfigured).toBe(false);
    expect(result.stale).toBe(false);
  });

  it('has no launch() (not a standalone binary)', () => {
    expect(clineIntegration.launch).toBeUndefined();
  });
});
