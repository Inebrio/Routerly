import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import lockfile from 'proper-lockfile';
import type { ModelConfig, RouterConfig, UserConfig, RoleConfig, Settings, UsageRecord, NotificationInboxItem, ModuleRecord, ProviderConnection, ModelInstance, Profile, ExperimentConfig } from '@routerly/shared';
import { CONFIG_PATHS } from '../../lib/paths.js';
import { readUsageNdjson, writeUsageNdjson, appendUsageRecordsNdjson } from './usageNdjson.js';
import { SECRET_KEYS } from './permission-guard.js';

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

/** The persisted "already announced" record for the update checker (RA-15). */
export interface UpdateAnnouncement {
  announcedVersion: string;
  currentVersion: string;
  channel: string;
  announcedAt: string;
}

// ─── Default configs ──────────────────────────────────────────────────────────

const DEFAULTS: Record<string, unknown> = {
  settings: {
    port: 3000,
    host: '0.0.0.0',
    dashboardEnabled: true,
    logLevel: 'info',
    publicUrl: 'http://localhost:3000',
    channel: 'latest',
  } satisfies Settings,
  models: [] as ModelConfig[],
  routers: [] as RouterConfig[],
  users: [] as UserConfig[],
  roles: [] as RoleConfig[],
  // 'provider-web' defaults DISABLED (unofficial, ToS-risk web-cookie adapters) —
  // 'provider-oauth' has no record here and defaults enabled via isModuleEnabled's
  // "no record = enabled" fallback.
  modules: [{ id: 'provider-web', enabled: false } satisfies ModuleRecord] as ModuleRecord[],
  profiles: [] as Profile[],
  experiments: [] as ExperimentConfig[],
  connections: [] as ProviderConnection[],
  instances: [] as ModelInstance[],
  usage: [] as UsageRecord[],
  notifications: [] as NotificationInboxItem[],
  audit: [] as AuditEntry[],
  updateAnnouncement: {} as Partial<UpdateAnnouncement>,
};

// ─── File mapping ─────────────────────────────────────────────────────────────

type StoredTypeMap = {
  settings: Settings;
  models: ModelConfig[];
  routers: RouterConfig[];
  users: UserConfig[];
  roles: RoleConfig[];
  modules: ModuleRecord[];
  profiles: Profile[];
  experiments: ExperimentConfig[];
  connections: ProviderConnection[];
  instances: ModelInstance[];
  usage: UsageRecord[];
  notifications: NotificationInboxItem[];
  audit: AuditEntry[];
  updateAnnouncement: Partial<UpdateAnnouncement>;
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
 * with `[]` and wiped routers.json. Writes are now atomic (temp + rename), but
 * we also defend the read: an existing-but-empty file is re-read a couple of
 * times to ride out any racing write, and if still empty we return the default
 * IN MEMORY only — never writing it back. Only ENOENT (file truly missing,
 * genuine first run) creates the file with defaults.
 */
export async function readConfig<K extends keyof StoredTypeMap>(
  key: K,
): Promise<StoredTypeMap[K]> {
  // Usage history lives in append-only NDJSON (RTR-06), not a JSON array file —
  // delegate to its own reader instead of the generic read-modify-write path below.
  if (key === 'usage') {
    return (await readUsageNdjson()) as StoredTypeMap[K];
  }
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
 * truncated window that a direct writeFile() opens (and that wiped routers.json).
 */
export async function writeConfig<K extends keyof StoredTypeMap>(
  key: K,
  data: StoredTypeMap[K],
): Promise<void> {
  // Usage history: same NDJSON delegation as readConfig above. Still a full
  // atomic rewrite (used by pruneOrphanUsage and the retention sweep — both
  // occasional, off the per-request hot path), just via the NDJSON writer.
  if (key === 'usage') {
    await writeUsageNdjson(data as UsageRecord[]);
    return;
  }
  const filePath = CONFIG_PATHS[key];

  // Ensure parent dir exists
  await mkdir(dirname(filePath), { recursive: true });

  // Write initial file if missing (lockfile requires the file to exist)
  try {
    await readFile(filePath);
  } catch {
    // Seed with the correct empty default, not '{}', so a crash between here
    // and the rename never leaves a type-wrong placeholder on disk.
    const seedOptions: { encoding: 'utf-8'; mode?: number } = { encoding: 'utf-8' };
    if ((SECRET_KEYS as readonly string[]).includes(key)) seedOptions.mode = 0o600;
    await writeFile(filePath, JSON.stringify(DEFAULTS[key], null, 2), seedOptions);
  }

  const tmpPath = `${filePath}.tmp-${process.pid}-${tmpCounter++}`;
  let release: (() => Promise<void>) | undefined;
  try {
    // Budget bumped (5→10 retries, capped 500ms backoff) so transient lock
    // contention on any config key rides out instead of throwing a dropped
    // write; kept modest so a real deadlock still surfaces. Usage records no
    // longer go through this path per-write (RTR-06: append-only NDJSON,
    // usageNdjson.ts) — this write path is now only the occasional full
    // rewrite (settings/projects/etc., plus usage's pruneOrphanUsage/retention
    // sweep via writeUsageNdjson's own identical lock).
    release = await lockfile.lock(filePath, {
      retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
    });
    // Atomic publish: full content to temp, then rename over the target.
    // Secret-tier files (SECRET_KEYS) are written 0600 from the start —
    // rename() preserves the temp file's mode, so without this every write
    // re-created the target at the umask default (typically 0644) and
    // re-tripped permission-guard's startup check on the very next boot.
    const writeOptions: { encoding: 'utf-8'; mode?: number } = { encoding: 'utf-8' };
    if ((SECRET_KEYS as readonly string[]).includes(key)) writeOptions.mode = 0o600;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), writeOptions);
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
 * Thrown from an `updateConfig` mutator to abort the read-mutate-write cycle
 * without persisting anything, while still carrying the HTTP status/body an
 * API route should reply with. The lock is released (via the same
 * try/finally as any other failure) before this propagates to the caller.
 */
export class ConfigUpdateAbort extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`config update aborted (status ${status})`);
  }
}

/**
 * Atomically reads, mutates and writes back one config file under a single
 * hold of the same `proper-lockfile` lock `writeConfig` uses — closing the
 * read-modify-write race a bare `readConfig()` ... `writeConfig()` pair left
 * open (B2/EC4): two concurrent callers each captured their own stale
 * in-memory copy of the array, and whichever's write landed last silently
 * discarded the other's addition even though both requests had already been
 * told 201/200.
 *
 * `mutate` receives the freshest possible read (taken after the lock is
 * held, so no other writer can interleave) and returns the value to persist.
 * Returning the exact same reference it was given is a no-op: signals
 * "nothing changed" and skips the write entirely (mirrors the historical
 * conditional-write call sites this replaces).
 *
 * Retries are bumped from writeConfig's 10/50-500ms: the critical section is
 * now the read+validate+write, not just the write, so a burst of concurrent
 * callers holds the lock slightly longer each — a wider margin avoids
 * trading the data-loss bug for a wave of ELOCKED failures under load.
 */
export async function updateConfig<K extends keyof StoredTypeMap>(
  key: K,
  mutate: (current: StoredTypeMap[K]) => StoredTypeMap[K] | Promise<StoredTypeMap[K]>,
): Promise<StoredTypeMap[K]> {
  if (key === 'usage') {
    throw new Error(`updateConfig does not support 'usage' — it is append-only NDJSON, see appendUsageRecords`);
  }
  const filePath = CONFIG_PATHS[key];
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await readFile(filePath);
  } catch {
    await writeFile(filePath, JSON.stringify(DEFAULTS[key], null, 2), 'utf-8');
  }

  const tmpPath = `${filePath}.tmp-${process.pid}-${tmpCounter++}`;
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 1000 },
    });
    const current = await readConfig(key);
    const next = await mutate(current);
    if (next === current) return next; // no-op: mutator made no change, nothing to publish
    await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
    return next;
  } catch (err) {
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
  await appendUsageRecords([record]);
}

/**
 * Same, for records that finish together. Appends without reading or parsing
 * any existing content (RTR-06/AC2) — cost does not grow as the history grows.
 */
export async function appendUsageRecords(records: UsageRecord[]): Promise<void> {
  if (process.env['ROUTERLY_SKIP_TRACKING']) return; // ponytail: env guard, skips write in e2e/test runs
  if (records.length === 0) return;
  await appendUsageRecordsNdjson(records);
}

/**
 * One-shot cleanup of orphan usage records (#77, BUG-5).
 *
 * Drops usage rows whose routerId matches no existing router — residue from
 * the pre-fix guardrail path which wrote records under a fictitious
 * routerId 'guardrail'. Real routers' records are kept. Only rewrites the
 * file when something was actually removed. Returns the number removed.
 */
export async function pruneOrphanUsage(): Promise<number> {
  const [usage, routers] = await Promise.all([
    readConfig('usage'),
    readConfig('routers'),
  ]);
  const validIds = new Set(routers.map((r) => r.id));
  const kept = usage.filter((r) => validIds.has(r.routerId));
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
