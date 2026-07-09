import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ROUTERLY_HOME is set to an isolated tmp dir by test-setup.ts before this
// file is imported, so all reads/writes stay in the sandbox.
const HOME = process.env.ROUTERLY_HOME!;
const CLI_DIR = join(HOME, 'cli');
const CLI_CONFIG_PATH = join(CLI_DIR, 'config.json');
const INSTALL_CONFIG_PATH = join(HOME, 'config', 'cli.json');

// Always import after env is set (test-setup ran first).
import {
  listAccounts,
  getCurrentAccount,
  getAccount,
  saveAccount,
  removeAccount,
  renameAccount,
  switchAccount,
  requireAccount,
  getDefaultServiceUrl,
} from './store.js';
import type { AccountEntry } from './store.js';

const makeAccount = (alias: string, overrides: Partial<AccountEntry> = {}): AccountEntry => ({
  alias,
  serverUrl: 'http://localhost:3000',
  email: `${alias}@example.com`,
  token: 'tok',
  expiresAt: Date.now() + 3_600_000,
  ...overrides,
});

// Wipe CLI config between tests so each test starts clean.
afterEach(async () => {
  try {
    await rm(CLI_CONFIG_PATH);
  } catch {
    // file may not exist
  }
});

// ── readCliConfig / ensureDir ─────────────────────────────────────────────────

describe('listAccounts', () => {
  it('returns empty array when no config file exists', async () => {
    expect(await listAccounts()).toEqual([]);
  });

  it('returns accounts from existing config', async () => {
    await mkdir(CLI_DIR, { recursive: true });
    await writeFile(CLI_CONFIG_PATH, JSON.stringify({
      accounts: [makeAccount('home')],
      currentAlias: 'home',
    }), 'utf-8');
    const accounts = await listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.alias).toBe('home');
  });

  it('returns empty array when config JSON is malformed', async () => {
    await mkdir(CLI_DIR, { recursive: true });
    await writeFile(CLI_CONFIG_PATH, 'not-json', 'utf-8');
    expect(await listAccounts()).toEqual([]);
  });
});

// ── getCurrentAccount ─────────────────────────────────────────────────────────

describe('getCurrentAccount', () => {
  it('returns null when no config', async () => {
    expect(await getCurrentAccount()).toBeNull();
  });

  it('returns null when currentAlias is null', async () => {
    await mkdir(CLI_DIR, { recursive: true });
    await writeFile(CLI_CONFIG_PATH, JSON.stringify({ accounts: [], currentAlias: null }), 'utf-8');
    expect(await getCurrentAccount()).toBeNull();
  });

  it('returns null when currentAlias points to nonexistent account', async () => {
    await mkdir(CLI_DIR, { recursive: true });
    await writeFile(CLI_CONFIG_PATH, JSON.stringify({
      accounts: [makeAccount('home')],
      currentAlias: 'missing',
    }), 'utf-8');
    expect(await getCurrentAccount()).toBeNull();
  });

  it('returns the matching account', async () => {
    const acc = makeAccount('work');
    await mkdir(CLI_DIR, { recursive: true });
    await writeFile(CLI_CONFIG_PATH, JSON.stringify({ accounts: [acc], currentAlias: 'work' }), 'utf-8');
    expect(await getCurrentAccount()).toMatchObject({ alias: 'work' });
  });
});

// ── getAccount ────────────────────────────────────────────────────────────────

describe('getAccount', () => {
  it('returns null when alias not found', async () => {
    expect(await getAccount('nobody')).toBeNull();
  });

  it('returns the matching account by alias', async () => {
    await saveAccount(makeAccount('home'));
    expect(await getAccount('home')).toMatchObject({ alias: 'home' });
  });
});

// ── saveAccount ───────────────────────────────────────────────────────────────

describe('saveAccount', () => {
  it('adds new account and sets it as current when first', async () => {
    await saveAccount(makeAccount('home'));
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.currentAlias).toBe('home');
  });

  it('updates existing account by alias without adding a duplicate', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('home', { email: 'new@example.com' }));
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].email).toBe('new@example.com');
  });

  it('does not change currentAlias when adding a second account', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.accounts).toHaveLength(2);
    expect(cfg.currentAlias).toBe('home'); // first remains active
  });

  it('updates currentAlias when saving the active account', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('home', { token: 'new-tok' }));
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.currentAlias).toBe('home');
    expect(cfg.accounts[0].token).toBe('new-tok');
  });
});

// ── removeAccount ─────────────────────────────────────────────────────────────

describe('removeAccount', () => {
  it('returns false when alias does not exist', async () => {
    expect(await removeAccount('ghost')).toBe(false);
  });

  it('removes existing account and returns true', async () => {
    await saveAccount(makeAccount('home'));
    expect(await removeAccount('home')).toBe(true);
    expect(await listAccounts()).toHaveLength(0);
  });

  it('resets currentAlias to null when removing the only account', async () => {
    await saveAccount(makeAccount('home'));
    await removeAccount('home');
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.currentAlias).toBeNull();
  });

  it('resets currentAlias to the next account when removing current', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    // switch to 'home' first so 'home' is active
    await switchAccount('home');
    await removeAccount('home');
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    // next remaining account becomes current
    expect(cfg.currentAlias).toBe('work');
  });

  it('leaves currentAlias unchanged when removing a non-active account', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    await removeAccount('work');
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.currentAlias).toBe('home');
  });
});

// ── renameAccount ─────────────────────────────────────────────────────────────

describe('renameAccount', () => {
  it('returns not_found when alias does not exist', async () => {
    expect(await renameAccount('ghost', 'new')).toBe('not_found');
  });

  it('returns conflict when newAlias already exists', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    expect(await renameAccount('home', 'work')).toBe('conflict');
  });

  it('renames account and returns ok', async () => {
    await saveAccount(makeAccount('home'));
    expect(await renameAccount('home', 'house')).toBe('ok');
    expect(await getAccount('house')).not.toBeNull();
    expect(await getAccount('home')).toBeNull();
  });

  it('updates currentAlias when renaming the active account', async () => {
    await saveAccount(makeAccount('home'));
    await renameAccount('home', 'house');
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.currentAlias).toBe('house');
  });

  it('renames one account when multiple exist (false branch in for loop)', async () => {
    // Exercises the if (acc.alias === oldAlias) FALSE branch for the non-matching account
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    expect(await renameAccount('work', 'office')).toBe('ok');
    expect(await getAccount('office')).not.toBeNull();
    expect(await getAccount('home')).not.toBeNull(); // unchanged
  });

  it('does not update currentAlias when renaming a non-active account', async () => {
    // Exercises the if (cfg.currentAlias === oldAlias) FALSE branch
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    // home is current; rename work → office
    await renameAccount('work', 'office');
    const cfg = JSON.parse(await readFile(CLI_CONFIG_PATH, 'utf-8'));
    expect(cfg.currentAlias).toBe('home'); // unchanged
  });
});

// ── switchAccount ─────────────────────────────────────────────────────────────

describe('switchAccount', () => {
  it('returns false when alias does not exist', async () => {
    expect(await switchAccount('ghost')).toBe(false);
  });

  it('switches to existing account and returns true', async () => {
    await saveAccount(makeAccount('home'));
    await saveAccount(makeAccount('work'));
    expect(await switchAccount('work')).toBe(true);
    const current = await getCurrentAccount();
    expect(current?.alias).toBe('work');
  });
});

// ── requireAccount ────────────────────────────────────────────────────────────

describe('requireAccount', () => {
  let originalExit: typeof process.exit;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalExit = process.exit;
    originalError = console.error;
    console.error = () => {};
    process.exit = (() => { throw new Error('process.exit called'); }) as never;
  });

  afterEach(() => {
    process.exit = originalExit;
    console.error = originalError;
  });

  it('exits 1 when no account is logged in', async () => {
    await expect(requireAccount()).rejects.toThrow('process.exit called');
  });

  it('exits 1 when token is expired and no refreshToken', async () => {
    await saveAccount(makeAccount('home', { expiresAt: Date.now() - 1000 }));
    await expect(requireAccount()).rejects.toThrow('process.exit called');
  });

  it('returns account when token is valid', async () => {
    const acc = makeAccount('home');
    await saveAccount(acc);
    const result = await requireAccount();
    expect(result.alias).toBe('home');
  });

  it('returns account when token is expired but refreshToken is present', async () => {
    await saveAccount(makeAccount('home', {
      expiresAt: Date.now() - 1000,
      refreshToken: 'refresh-tok',
    }));
    // expired but has refreshToken — must NOT exit
    const result = await requireAccount();
    expect(result.alias).toBe('home');
  });
});

// ── getDefaultServiceUrl ──────────────────────────────────────────────────────

describe('getDefaultServiceUrl', () => {
  it('returns null when install config does not exist', async () => {
    expect(await getDefaultServiceUrl()).toBeNull();
  });

  it('returns the serviceUrl from install config', async () => {
    const configDir = join(HOME, 'config');
    await mkdir(configDir, { recursive: true });
    await writeFile(INSTALL_CONFIG_PATH, JSON.stringify({ serviceUrl: 'http://routerly.local:3000' }), 'utf-8');
    expect(await getDefaultServiceUrl()).toBe('http://routerly.local:3000');
  });

  it('returns null when serviceUrl key is absent', async () => {
    const configDir = join(HOME, 'config');
    await mkdir(configDir, { recursive: true });
    await writeFile(INSTALL_CONFIG_PATH, JSON.stringify({ other: 'value' }), 'utf-8');
    expect(await getDefaultServiceUrl()).toBeNull();
  });

  it('returns null when install config JSON is malformed', async () => {
    const configDir = join(HOME, 'config');
    await mkdir(configDir, { recursive: true });
    await writeFile(INSTALL_CONFIG_PATH, 'bad-json', 'utf-8');
    expect(await getDefaultServiceUrl()).toBeNull();
  });
});
