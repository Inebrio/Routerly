/**
 * End-to-end coverage of `routerly clients configure` on a fake home
 * directory: the real command, the real integrations, real files on disk.
 * Only the network edges are mocked (router list, account, token minting,
 * the /health probe), so a break anywhere in command -> registry -> writer
 * shows up here.
 *
 * The per-client unit tests cover merge semantics and rollback; this file
 * covers the wiring and the bytes that actually land on disk.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ROUTERLY_HOME is read at import time by lib/safe-file.js, so it has to be
// redirected before any import runs: backups must not touch the real home.
const { backupsHome, mockApi, mockRequireAccount, mockGetCurrentAccount, mockAcquireToken } = vi.hoisted(() => {
  // No imports usable here: vi.hoisted runs before them.
  const backupsHome = `${process.env.TMPDIR?.replace(/\/$/, '') ?? '/tmp'}/routerly-clients-e2e-home`;
  process.env.ROUTERLY_HOME = backupsHome;
  return {
    backupsHome,
    mockApi: vi.fn(),
    mockRequireAccount: vi.fn(),
    mockGetCurrentAccount: vi.fn(),
    mockAcquireToken: vi.fn(),
  };
});

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
  requireAccount: mockRequireAccount,
  getCurrentAccount: mockGetCurrentAccount,
}));

vi.mock('./token.js', () => ({ acquireToken: mockAcquireToken }));

import { makeClientsCommand } from '../commands/clients.js';

const SERVER_URL = 'http://localhost:3000';
const TOKEN = 'sk-rt-e2e-token';

const account = {
  alias: 'test',
  serverUrl: SERVER_URL,
  email: 'admin@example.com',
  token: 'jwt-test',
  expiresAt: Date.now() + 3_600_000,
};

const router = {
  id: 'proj-1',
  name: 'my-api',
  models: [],
  timeoutMs: 5000,
  autoRouting: true,
  tokens: [],
  members: [],
  policies: [],
};

const ORIGINAL_HOME = process.env.HOME;
let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'routerly-clients-e2e-'));
  process.env.HOME = fakeHome;
  mockApi.mockReset().mockResolvedValue([router]);
  mockRequireAccount.mockReset().mockResolvedValue(account);
  mockGetCurrentAccount.mockReset().mockResolvedValue(account);
  mockAcquireToken.mockReset().mockResolvedValue(TOKEN);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  process.env.HOME = ORIGINAL_HOME;
  await rm(fakeHome, { recursive: true, force: true });
  await rm(backupsHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function configure(id: string): Promise<{ filePath: string; content: string; backupId: string }> {
  const output: string[] = [];
  vi.mocked(console.log).mockImplementation((...a: unknown[]) => output.push(a.join(' ')));
  const cmd = makeClientsCommand();
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'clients', 'configure', id, '--router', 'my-api', '--yes', '--json']);
  const parsed = JSON.parse(output.join('\n')) as { plan: { filePath: string }; applied: { backupId: string } };
  return {
    filePath: parsed.plan.filePath,
    content: await readFile(parsed.plan.filePath, 'utf-8'),
    backupId: parsed.applied.backupId,
  };
}

describe('clients configure end-to-end', () => {
  it('claude-code: writes settings.json under the fake home with the gateway root', async () => {
    const { filePath, content } = await configure('claude-code');
    expect(filePath).toBe(join(fakeHome, '.claude', 'settings.json'));
    const parsed = JSON.parse(content);
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe(SERVER_URL);
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
  });

  it('codex: writes config.toml with the /v1 base URL and the bearer token', async () => {
    const { filePath, content } = await configure('codex');
    expect(filePath).toBe(join(fakeHome, '.codex', 'config.toml'));
    expect(content).toContain('[model_providers.routerly]');
    expect(content).toContain(`base_url = "${SERVER_URL}/v1"`);
    expect(content).toContain(`experimental_bearer_token = "${TOKEN}"`);
  });

  it('opencode: writes opencode.json with the routerly provider', async () => {
    const { filePath, content } = await configure('opencode');
    expect(filePath).toBe(join(fakeHome, '.config', 'opencode', 'opencode.json'));
    const parsed = JSON.parse(content);
    expect(parsed.provider.routerly.options.baseURL).toBe(`${SERVER_URL}/v1`);
    expect(parsed.provider.routerly.options.apiKey).toBe(TOKEN);
  });

  it('continue: writes config.yaml with the Routerly model entry', async () => {
    const { filePath, content } = await configure('continue');
    expect(filePath).toBe(join(fakeHome, '.continue', 'config.yaml'));
    expect(content).toContain(`apiBase: ${SERVER_URL}/v1`);
    expect(content).toContain(`apiKey: ${TOKEN}`);
  });

  it('writes the config file with owner-only permissions, it carries a token', async () => {
    const { filePath } = await configure('claude-code');
    const stats = await stat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('undo restores the file to its pre-configure state', async () => {
    const { filePath, backupId } = await configure('codex');
    await expect(stat(filePath)).resolves.toBeDefined();

    const cmd = makeClientsCommand();
    cmd.exitOverride();
    await cmd.parseAsync(['node', 'clients', 'undo', backupId]);

    // The file did not exist before configure, so undo removes it entirely.
    await expect(stat(filePath)).rejects.toThrow();
  });

  it('a documented client writes nothing at all', async () => {
    const cmd = makeClientsCommand();
    cmd.exitOverride();
    await cmd.parseAsync(['node', 'clients', 'configure', 'zed', '--router', 'my-api', '--yes', '--json']);
    await expect(stat(join(fakeHome, '.config', 'zed', 'settings.json'))).rejects.toThrow();
  });
});
