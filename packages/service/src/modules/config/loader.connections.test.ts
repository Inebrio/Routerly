import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('proper-lockfile', () => ({
  default: { lock: vi.fn() },
}));

vi.mock('../../lib/paths.js', () => ({
  CONFIG_PATHS: {
    base: '/test',
    config: '/test/config',
    data: '/test/data',
    settings: '/test/config/settings.json',
    models: '/test/config/models.json',
    projects: '/test/config/projects.json',
    users: '/test/config/users.json',
    roles: '/test/config/roles.json',
    modules: '/test/config/modules.json',
    connections: '/test/config/connections.json',
    instances: '/test/config/instances.json',
    usage: '/test/data/usage.json',
    notifications: '/test/data/notifications.json',
    audit: '/test/data/audit.json',
    secret: '/test/config/secret',
  },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

import { readConfig } from './loader.js';
import * as fs from 'node:fs/promises';
import lockfile from 'proper-lockfile';

const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockRename = vi.mocked(fs.rename);
const mockLock = vi.mocked(lockfile.lock);

describe('loader.connections', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults connections + instances to empty arrays', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(err);
    const releaseFn = vi.fn().mockResolvedValue(undefined);
    mockLock.mockResolvedValue(releaseFn);
    // Second readFile call (inside writeConfig) also fails → write initial file
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const connections = await readConfig('connections');
    expect(connections).toEqual([]);

    // Reset mocks for instances call
    vi.clearAllMocks();
    mockReadFile.mockRejectedValueOnce(err);
    mockLock.mockResolvedValue(releaseFn);
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const instances = await readConfig('instances');
    expect(instances).toEqual([]);
  });
});
