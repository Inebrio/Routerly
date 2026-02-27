import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { encrypt, decrypt } from '@localrouter/shared';
import type { ModelConfig, ProjectConfig, UserConfig, RoleConfig, Settings, UsageRecord } from '@localrouter/shared';

const base = process.env['LOCALROUTER_HOME'] ?? join(homedir(), '.localrouter');

export const PATHS = {
  config: join(base, 'config'),
  data: join(base, 'data'),
  settings: join(base, 'config', 'settings.json'),
  models: join(base, 'config', 'models.json'),
  projects: join(base, 'config', 'projects.json'),
  users: join(base, 'config', 'users.json'),
  roles: join(base, 'config', 'roles.json'),
  usage: join(base, 'data', 'usage.json'),
};

type StoreMap = {
  settings: Settings;
  models: ModelConfig[];
  projects: ProjectConfig[];
  users: UserConfig[];
  roles: RoleConfig[];
  usage: UsageRecord[];
};

const DEFAULTS: StoreMap = {
  settings: { port: 3000, host: '0.0.0.0', dashboardEnabled: true, defaultTimeoutMs: 30000, logLevel: 'info' },
  models: [],
  projects: [],
  users: [],
  roles: [],
  usage: [],
};

async function ensureDirs() {
  await mkdir(PATHS.config, { recursive: true });
  await mkdir(PATHS.data, { recursive: true });
}

export async function readStore<K extends keyof StoreMap>(key: K): Promise<StoreMap[K]> {
  await ensureDirs();
  const path = PATHS[key];
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as StoreMap[K];
  } catch {
    return DEFAULTS[key] as StoreMap[K];
  }
}

export async function writeStore<K extends keyof StoreMap>(key: K, data: StoreMap[K]): Promise<void> {
  await ensureDirs();
  await writeFile(PATHS[key], JSON.stringify(data, null, 2), 'utf-8');
}

export function encryptValue(v: string): string { return encrypt(v); }
export function decryptValue(v: string): string { return decrypt(v); }
