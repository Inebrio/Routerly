import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// ─── CLI config lives in the user's home dir, independent of the service ─────
// Multiple users on the same machine each have their own config.
// The service config lives elsewhere (e.g. /etc/routerly or ~/.routerly).

const CLI_DIR = join(homedir(), '.routerly', 'cli');
const CLI_CONFIG_PATH = join(CLI_DIR, 'config.json');

export interface AccountEntry {
  /** Friendly alias chosen at login, e.g. "home", "work" */
  alias: string;
  /** Base URL of the Routerly service, e.g. http://localhost:3000 */
  serverUrl: string;
  /** Email used to log in */
  email: string;
  /** Session token returned by POST /api/auth/login */
  token: string;
  /** Token expiry timestamp (ms since epoch) */
  expiresAt: number;
}

export interface CliConfig {
  accounts: AccountEntry[];
  /** Alias of the currently active account */
  currentAlias: string | null;
}

async function ensureDir(): Promise<void> {
  await mkdir(CLI_DIR, { recursive: true });
}

async function readCliConfig(): Promise<CliConfig> {
  await ensureDir();
  try {
    const raw = await readFile(CLI_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  } catch {
    return { accounts: [], currentAlias: null };
  }
}

async function writeCliConfig(config: CliConfig): Promise<void> {
  await ensureDir();
  await writeFile(CLI_CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<AccountEntry[]> {
  const cfg = await readCliConfig();
  return cfg.accounts;
}

export async function getCurrentAccount(): Promise<AccountEntry | null> {
  const cfg = await readCliConfig();
  if (!cfg.currentAlias) return null;
  return cfg.accounts.find(a => a.alias === cfg.currentAlias) ?? null;
}

export async function getAccount(alias: string): Promise<AccountEntry | null> {
  const cfg = await readCliConfig();
  return cfg.accounts.find(a => a.alias === alias) ?? null;
}

export async function saveAccount(entry: AccountEntry): Promise<void> {
  const cfg = await readCliConfig();
  const idx = cfg.accounts.findIndex(a => a.alias === entry.alias);
  if (idx >= 0) {
    cfg.accounts[idx] = entry;
  } else {
    cfg.accounts.push(entry);
  }
  // Automatically activate if it's the first account, or replace current alias's entry
  if (!cfg.currentAlias || cfg.currentAlias === entry.alias) {
    cfg.currentAlias = entry.alias;
  }
  await writeCliConfig(cfg);
}

export async function removeAccount(alias: string): Promise<boolean> {
  const cfg = await readCliConfig();
  const before = cfg.accounts.length;
  cfg.accounts = cfg.accounts.filter(a => a.alias !== alias);
  if (cfg.accounts.length === before) return false;
  if (cfg.currentAlias === alias) {
    cfg.currentAlias = cfg.accounts[0]?.alias ?? null;
  }
  await writeCliConfig(cfg);
  return true;
}

export async function switchAccount(alias: string): Promise<boolean> {
  const cfg = await readCliConfig();
  if (!cfg.accounts.find(a => a.alias === alias)) return false;
  cfg.currentAlias = alias;
  await writeCliConfig(cfg);
  return true;
}

/** Returns the active account or exits with a helpful message. */
export async function requireAccount(): Promise<AccountEntry> {
  const account = await getCurrentAccount();
  if (!account) {
    console.error('Not logged in. Run: routerly auth login');
    process.exit(1);
  }
  if (account.expiresAt < Date.now()) {
    console.error(`Session for "${account.alias}" has expired. Run: routerly auth login`);
    process.exit(1);
  }
  return account;
}
