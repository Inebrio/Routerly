import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import { CONFIG_PATHS } from './lib/paths.js';
import { startServer } from './server.js';

// Real filesystem (test-setup.ts already isolates CONFIG_PATHS.base into a
// throwaway temp dir for this test file), real config/loader.js and
// config/migrate.js — no mocks. Reproduces RTR-06 B1: a corrupted legacy
// usage.json must stop the service from starting (EC2), not be swallowed by
// the kernel's best-effort migrate() catch. startServer() throws here before
// ever calling buildServer()/listen(), so no server is left listening.
describe('startServer — fatal usage.json migration (RTR-06 B1)', () => {
  beforeEach(async () => {
    await mkdir(CONFIG_PATHS.data, { recursive: true });
  });

  afterEach(async () => {
    await rm(CONFIG_PATHS.usage, { force: true });
    await rm(CONFIG_PATHS.usageLegacyJson, { force: true });
    await rm(`${CONFIG_PATHS.usageLegacyJson}.migrated`, { force: true });
  });

  it('rejects instead of starting the server when usage.json is corrupted', async () => {
    await writeFile(CONFIG_PATHS.usageLegacyJson, '{not valid json at all', 'utf-8');

    await expect(startServer()).rejects.toThrow();

    // The migration never reached its publish step: no partial/empty
    // usage.ndjson was left behind, and the corrupt legacy file was not
    // renamed to .migrated (it is only ever retired on a successful migration).
    await expect(access(CONFIG_PATHS.usage)).rejects.toThrow();
    await expect(access(CONFIG_PATHS.usageLegacyJson)).resolves.toBeUndefined();
  });
});
