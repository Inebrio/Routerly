import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import lockfile from 'proper-lockfile';
import type { ModelConfig, ProjectConfig, UserConfig, RoleConfig, Settings, UsageRecord, NotificationInboxItem } from '@routerly/shared';
import { CONFIG_PATHS } from './paths.js';

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
 */
export async function readConfig<K extends keyof StoredTypeMap>(
  key: K,
): Promise<StoredTypeMap[K]> {
  const filePath = CONFIG_PATHS[key];
  try {
    const raw = await readFile(filePath, 'utf-8');
    const trimmed = raw.trim();
    if (!trimmed) {
      // File exists but is empty — treat as missing
      const defaultValue = DEFAULTS[key] as StoredTypeMap[K];
      await writeConfig(key, defaultValue);
      return defaultValue;
    }
    return JSON.parse(trimmed) as StoredTypeMap[K];
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      const defaultValue = DEFAULTS[key] as StoredTypeMap[K];
      await writeConfig(key, defaultValue);
      return defaultValue;
    }
    throw err;
  }
}

/**
 * Writes a config file atomically using a lock.
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
    await writeFile(filePath, '{}', 'utf-8');
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, { retries: { retries: 5, minTimeout: 50 } });
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } finally {
    if (release) await release();
  }
}

/**
 * Appends a single usage record without locking the whole file for long.
 */
export async function appendUsageRecord(record: UsageRecord): Promise<void> {
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
