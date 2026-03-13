import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.env['LOCALROUTER_HOME'] ?? join(homedir(), '.localrouter');

export const CONFIG_PATHS = {
  base,
  config: join(base, 'config'),
  data: join(base, 'data'),
  settings: join(base, 'config', 'settings.json'),
  models: join(base, 'config', 'models.json'),
  projects: join(base, 'config', 'projects.json'),
  users: join(base, 'config', 'users.json'),
  roles: join(base, 'config', 'roles.json'),
  usage: join(base, 'data', 'usage.json'),
  secret: join(base, 'config', 'secret'),
} as const;

export type ConfigFile = keyof typeof CONFIG_PATHS;
