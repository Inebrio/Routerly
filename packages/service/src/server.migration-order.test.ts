import { describe, it, expect, vi } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_PATHS } from './lib/paths.js'

// Real-filesystem regression test for the RTR-01 remediation (validator
// report .claude/specs/0.4.1/03-validation/RTR-01.md, finding B1).
//
// server.test.ts mocks './modules/config/loader.js' and './modules/config/
// migrate.js' entirely, so it never exercises the actual race between
// pruneOrphanUsage()'s incidental readConfig('routers') and
// migrateRouterStorage()'s "does routers.json already exist?" idempotency
// check. This file deliberately does NOT mock either module: it seeds a real
// legacy config/projects.json (17 entities, matching the validator's
// fixture) with no routers.json, boots the server for real, and asserts the
// pre-existing entities survive. Everything else that would otherwise touch
// the network (telemetry, update-checker, notifications) or open real
// listener plumbing we don't need (dashboard static files, auth/openai/
// anthropic routes) is still mocked, same as server.test.ts.
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

describe('startServer — real migration/prune ordering (RTR-01 regression)', () => {
  it('preserves every pre-existing router when routers.json does not exist yet', async () => {
    await initConfigDirs()

    // Legacy projects.json fixture — 17 pre-existing entities under the old
    // name, matching the validator's reproduction. No routers.json exists
    // yet: this is exactly the state a real from-scratch upgrade is in.
    const legacyRouters = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, name: `Router ${i}` }))
    await writeFile(
      join(CONFIG_PATHS.config, 'projects.json'),
      JSON.stringify(legacyRouters, null, 2),
      'utf-8',
    )

    await writeConfig('settings', {
      logLevel: 'silent',
      dashboardEnabled: false,
      port: 0,
      host: '127.0.0.1',
      telemetry: { enabled: false },
    } as any)

    await startServer()

    const onDisk = JSON.parse(await readFile(CONFIG_PATHS.routers, 'utf-8'))
    expect(onDisk).toHaveLength(17)
  })
})
