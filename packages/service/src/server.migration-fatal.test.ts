import { describe, it, expect, vi } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_PATHS } from './lib/paths.js'

// Real-filesystem regression test for the RTR-01 remediation (validator
// report .claude/specs/0.4.1/03-validation/RTR-01.md, iteration 2, finding
// B2): a malformed config/projects.json must stop the boot (EC3), not start
// the service on an empty routers.json, and must not leave behind a
// "migrated" marker that blocks the real migration on a later, fixed retry.
//
// Same mock set as server.migration-order.test.ts (B1's regression test):
// everything that would otherwise touch the network or open listener
// plumbing we don't need is mocked; config/loader.js and config/migrate.js
// are deliberately left real.
vi.mock('./modules/auth/jwt.js', () => ({
  loadSecret: vi.fn(),
  createSessionToken: vi.fn(() => 'token'),
  verifyToken: vi.fn(() => null),
  generateRawToken: vi.fn(() => 'raw'),
}))
vi.mock('./lib/crypto-cred.js', () => ({ loadCredentialKey: vi.fn() }))
vi.mock('./modules/auth/auth.js', () => ({ default: vi.fn(async () => {}) }))
vi.mock('./modules/api-reverse-proxy/openai.js', () => ({ openaiRoutes: vi.fn(async () => {}) }))
vi.mock('./modules/api-reverse-proxy/anthropic.js', () => ({ anthropicRoutes: vi.fn(async () => {}) }))
vi.mock('./modules/api/api.js', () => ({ apiRoutes: vi.fn(async () => {}) }))
vi.mock('./modules/telemetry/telemetry.js', () => ({ pingTelemetry: vi.fn().mockResolvedValue(true) }))
vi.mock('./modules/notifications/emitter.js', () => ({ emitEvent: vi.fn(async () => {}) }))
vi.mock('./modules/update-checker/update-checker.js', () => ({
  updateChecker: { start: vi.fn(), check: vi.fn(), getLastResult: vi.fn(() => null), getAvailableReleases: vi.fn(() => []), updateChannel: vi.fn() }
}))

import { startServer } from './server.js'
import { initConfigDirs, writeConfig } from './modules/config/loader.js'

async function writeSettings() {
  await writeConfig('settings', {
    logLevel: 'silent',
    dashboardEnabled: false,
    port: 0,
    host: '127.0.0.1',
    telemetry: { enabled: false },
  } as any)
}

describe('startServer — malformed projects.json is fatal, not a silent empty migration (RTR-01 B2 regression)', () => {
  it('does not start on malformed projects.json, leaves no empty routers.json, and migrates for real once the file is fixed', async () => {
    await initConfigDirs()
    await writeSettings()

    // Malformed legacy file — same shape as the validator's EC3 repro.
    const legacyPath = join(CONFIG_PATHS.config, 'projects.json')
    await writeFile(legacyPath, '{not valid json!!!', 'utf-8')

    await expect(startServer()).rejects.toThrow(/not valid JSON/)

    // The service must not have gotten far enough to auto-create
    // routers.json — no partial/empty file left behind to falsely satisfy
    // migrateRouterStorage()'s own "already migrated" idempotency check.
    await expect(readFile(CONFIG_PATHS.routers, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })

    // Operator fixes the file and restarts.
    const legacyRouters = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Router ${i}` }))
    await writeFile(legacyPath, JSON.stringify(legacyRouters, null, 2), 'utf-8')

    await startServer()

    const onDisk = JSON.parse(await readFile(CONFIG_PATHS.routers, 'utf-8'))
    expect(onDisk).toHaveLength(5)
  })
})
