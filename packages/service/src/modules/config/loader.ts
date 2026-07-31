import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import lockfile from 'proper-lockfile';
import type { ModelConfig, ProjectConfig, UserConfig, RoleConfig, Settings, UsageRecord, NotificationInboxItem, ModuleRecord, ProviderConnection, ModelInstance, Profile } from '@routerly/shared';
import { CONFIG_PATHS } from '../../lib/paths.js';

/** Mirrors audit/logger.ts AuditEntry — defined here to avoid circular import */
export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  email: string;
  endpoint: string;
  action: string;
  result: 'success' | 'forbidden' | 'error';
  details?: Record<string, unknown>;
}

// ─── Default configs ──────────────────────────────────────────────────────────

const DEFAULTS: Record<string, unknown> = {
  settings: {
    port: 3000,
    host: '0.0.0.0',
    dashboardEnabled: true,
    defaultTimeoutMs: 30000,
    logLevel: 'info',
    publicUrl: 'http://localhost:3000',
    channel: 'latest',
  } satisfies Settings,
  models: [] as ModelConfig[],
  projects: [] as ProjectConfig[],
  users: [] as UserConfig[],
  roles: [] as RoleConfig[],
  // 'provider-web' defaults DISABLED (unofficial, ToS-risk web-cookie adapters) —
  // 'provider-oauth' has no record here and defaults enabled via isModuleEnabled's
  // "no record = enabled" fallback.
  modules: [{ id: 'provider-web', enabled: false } satisfies ModuleRecord] as ModuleRecord[],
  profiles: [] as Profile[],
  connections: [] as ProviderConnection[],
  instances: [] as ModelInstance[],
  usage: [] as UsageRecord[],
  notifications: [] as NotificationInboxItem[],
  audit: [] as AuditEntry[],
};

// ─── File mapping ─────────────────────────────────────────────────────────────

type StoredTypeMap = {
  settings: Settings;
  models: ModelConfig[];
  projects: ProjectConfig[];
  users: UserConfig[];
  roles: RoleConfig[];
  modules: ModuleRecord[];
  profiles: Profile[];
  connections: ProviderConnection[];
  instances: ModelInstance[];
  usage: UsageRecord[];
  notifications: NotificationInboxItem[];
  audit: AuditEntry[];
};

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Ensures the config directory structure exists.
 */
export async function initConfigDirs(): Promise<void> {
  await mkdir(CONFIG_PATHS.config, { recursive: true });
  await mkdir(CONFIG_PATHS.data, { recursive: true });
}

/**
 * Reads a config file, creating it with defaults if it doesn't exist.
 *
 * A transient-empty read (another process mid-write under the old, non-atomic
 * writeConfig) MUST NOT persist anything: doing so clobbered a populated file
 * with `[]` and wiped projects.json. Writes are now atomic (temp + rename), but
 * we also defend the read: an existing-but-empty file is re-read a couple of
 * times to ride out any racing write, and if still empty we return the default
 * IN MEMORY only — never writing it back. Only ENOENT (file truly missing,
 * genuine first run) creates the file with defaults.
 */
export async function readConfig<K extends keyof StoredTypeMap>(
  key: K,
): Promise<StoredTypeMap[K]> {
  const filePath = CONFIG_PATHS[key];
  try {
    let raw = await readFile(filePath, 'utf-8');
    let trimmed = raw.trim();
    // Existing-but-empty: could be a transient truncation from a concurrent
    // writer. Re-read a couple of times before trusting the emptiness.
    for (let attempt = 0; !trimmed && attempt < 2; attempt++) {
      await delay(10);
      raw = await readFile(filePath, 'utf-8');
      trimmed = raw.trim();
    }
    if (!trimmed) {
      // Still empty after retries — return the default in memory; do NOT write
      // it back (that is exactly how a transient empty read wiped real data).
      return DEFAULTS[key] as StoredTypeMap[K];
    }
    return JSON.parse(trimmed) as StoredTypeMap[K];
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      // Genuine first run — file truly missing. Create it with defaults.
      const defaultValue = DEFAULTS[key] as StoredTypeMap[K];
      await writeConfig(key, defaultValue);
      return defaultValue;
    }
    throw err;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Monotonic temp-file suffix counter — pid + counter uniquely names each temp
// without Date.now/Math.random, so concurrent writers never collide.
let tmpCounter = 0;

/**
 * Writes a config file atomically using a lock.
 *
 * The write is atomic: data goes to a sibling temp file which is then renamed
 * over the target. rename() is atomic on POSIX, so a concurrent reader always
 * sees either the complete old file or the complete new one — never the empty,
 * truncated window that a direct writeFile() opens (and that wiped projects.json).
 */
export async function writeConfig<K extends keyof StoredTypeMap>(
  key: K,
  data: StoredTypeMap[K],
): Promise<void> {
  const filePath = CONFIG_PATHS[key];

  // Ensure parent dir exists
  await mkdir(dirname(filePath), { recursive: true });

  // Write initial file if missing (lockfile requires the file to exist)
  try {
    await readFile(filePath);
  } catch {
    // Seed with the correct empty default, not '{}', so a crash between here
    // and the rename never leaves a type-wrong placeholder on disk.
    await writeFile(filePath, JSON.stringify(DEFAULTS[key], null, 2), 'utf-8');
  }

  const tmpPath = `${filePath}.tmp-${process.pid}-${tmpCounter++}`;
  let release: (() => Promise<void>) | undefined;
  try {
    // ponytail: whole-file read-modify-write per usage append under this global
    // lock is O(n) per record; if write throughput ever demands it the upgrade is
    // append-only usage writes (NDJSON append), not a bigger retry budget. Budget
    // bumped (5→10 retries, capped 500ms backoff) so transient contention — e.g.
    // appendUsageRecord on the request hot path — rides out instead of throwing a
    // dropped write; kept modest so a real deadlock still surfaces.
    release = await lockfile.lock(filePath, {
      retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
    });
    // Atomic publish: full content to temp, then rename over the target.
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file on failure (rename never ran).
    await unlink(tmpPath).catch(() => {});
    throw err;
  } finally {
    if (release) await release();
  }
}

/**
 * Appends a single usage record without locking the whole file for long.
 */
export async function appendUsageRecord(record: UsageRecord): Promise<void> {
  if (process.env['ROUTERLY_SKIP_TRACKING']) return; // ponytail: env guard, skips write in e2e/test runs
  const existing = await readConfig('usage');
  existing.push(record);
  await writeConfig('usage', existing);
}

/**
 * One-shot cleanup of orphan usage records (#77, BUG-5).
 *
 * Drops usage rows whose projectId matches no existing project — residue from
 * the pre-fix guardrail path which wrote records under a fictitious
 * projectId 'guardrail'. Real projects' records are kept. Only rewrites the
 * file when something was actually removed. Returns the number removed.
 */
export async function pruneOrphanUsage(): Promise<number> {
  const [usage, projects] = await Promise.all([
    readConfig('usage'),
    readConfig('projects'),
  ]);
  const validIds = new Set(projects.map((p) => p.id));
  const kept = usage.filter((r) => validIds.has(r.projectId));
  const removed = usage.length - kept.length;
  if (removed > 0) await writeConfig('usage', kept);
  return removed;
}

/**
 * Reads the signing secret from the config directory, generating one if it
 * does not exist yet. The file is created with mode 0600 (owner read/write only).
 */
export async function getOrCreateSecret(): Promise<string> {
  const filePath = CONFIG_PATHS.secret;
  await mkdir(CONFIG_PATHS.config, { recursive: true });
  try {
    return (await readFile(filePath, 'utf-8')).trim();
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      const secret = randomBytes(32).toString('hex');
      await writeFile(filePath, secret, { encoding: 'utf-8', mode: 0o600 });
      await chmod(filePath, 0o600);
      return secret;
    }
    throw err;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
