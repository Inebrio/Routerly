import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import type { ModelConfig, ProjectConfig, UserConfig, RoleConfig, Settings, UsageRecord } from '@localrouter/shared';
import { CONFIG_PATHS } from './paths.js';

// ─── Default configs ──────────────────────────────────────────────────────────

const DEFAULTS: Record<string, unknown> = {
  settings: {
    port: 3000,
    host: '0.0.0.0',
    dashboardEnabled: true,
    defaultTimeoutMs: 30000,
    logLevel: 'info',
    publicUrl: 'http://localhost:3000',
  } satisfies Settings,
  models: [] as ModelConfig[],
  projects: [] as ProjectConfig[],
  users: [] as UserConfig[],
  roles: [] as RoleConfig[],
  usage: [] as UsageRecord[],
};

// ─── File mapping ─────────────────────────────────────────────────────────────

type StoredTypeMap = {
  settings: Settings;
  models: ModelConfig[];
  projects: ProjectConfig[];
  users: UserConfig[];
  roles: RoleConfig[];
  usage: UsageRecord[];
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
    return JSON.parse(raw) as StoredTypeMap[K];
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

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
