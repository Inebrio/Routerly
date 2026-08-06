import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./modules/config/loader.js', () => ({
  initConfigDirs: vi.fn(),
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  pruneOrphanUsage: vi.fn(async () => 0),
  appendUsageRecord: vi.fn(),
  getOrCreateSecret: vi.fn(),
}))
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
vi.mock('./modules/config/migrate.js', () => ({
  migrateProjectConfigs: vi.fn(async () => 0),
  migrateRouterStorage: vi.fn(async () => undefined as number | undefined),
  migrateUsageToNdjson: vi.fn(async () => 0),
}))
vi.mock('./modules/config/permission-guard.js', () => ({ enforceStartupGuard: vi.fn() }))

import { buildServer, startServer } from './server.js'
import { readConfig, writeConfig } from './modules/config/loader.js'
import { pingTelemetry } from './modules/telemetry/telemetry.js'
import { migrateUsageToNdjson } from './modules/config/migrate.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)
const mockPingTelemetry = vi.mocked(pingTelemetry)
const mockMigrateUsage = vi.mocked(migrateUsageToNdjson)

// bootstrap() now reads the 'modules' config key too (module enable/disable
// registry) — keyed mock keeps that read returning [] (no disabled modules)
// while callers still control the 'settings' shape they care about.
function mockSettings(settings: unknown): void {
  mockReadConfig.mockImplementation(async (key: string) =>
    (key === 'settings' ? settings : []) as any,
  )
}

afterEach(() => vi.clearAllMocks())

describe('buildServer', () => {
  it('builds a Fastify instance with dashboard disabled', async () => {
    mockSettings({ logLevel: 'silent', dashboardEnabled: false } as any)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/health' })
    await server.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('redirects GET / to /dashboard/', async () => {
    mockSettings({ logLevel: 'silent', dashboardEnabled: false } as any)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/' })
    await server.close()

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('/dashboard/')
  })

  it('builds with dashboardEnabled:true (dashboard dist not found — catches error gracefully)', async () => {
    mockSettings({ logLevel: 'silent', dashboardEnabled: true } as any)

    const server = await buildServer()
    await server.close()
  })

  // Regression (U6): metricsRoutes must be wired into the real server factory.
  // The isolated metrics.test.ts mounts the plugin directly and so missed this gap.
  it('serves GET /metrics (200, text/plain) — Prometheus endpoint is registered', async () => {
    mockSettings({ logLevel: 'silent', dashboardEnabled: false } as any)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/metrics' })
    await server.close()

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('# HELP routerly_requests_total')
  })
})

describe('startServer', () => {
  it('fires pingTelemetry install event on first start (no lastPingedVersion)', async () => {
    const settings: any = {
      logLevel: 'silent', dashboardEnabled: false,
      port: 3099, host: '127.0.0.1',
      telemetry: { enabled: true, installId: 'install-abc' },
    }
    mockSettings(settings)
    mockWriteConfig.mockResolvedValue(undefined)

    await startServer()

    expect(mockPingTelemetry).toHaveBeenCalledWith('install-abc', 'install')
    expect(mockWriteConfig).toHaveBeenCalled()
  })

  it('fires pingTelemetry upgrade event when version changed', async () => {
    const settings: any = {
      logLevel: 'silent', dashboardEnabled: false,
      port: 3098, host: '127.0.0.1',
      telemetry: { enabled: true, installId: 'install-xyz', lastPingedVersion: '0.0.0' },
    }
    mockSettings(settings)
    mockWriteConfig.mockResolvedValue(undefined)

    await startServer()

    expect(mockPingTelemetry).toHaveBeenCalledWith('install-xyz', 'upgrade')
  })

  it('does not fire pingTelemetry when version is unchanged', async () => {
    const pkgJson = await import('../package.json', { with: { type: 'json' } })
    const pkgVersion = (pkgJson as any).default?.version
    const settings: any = {
      logLevel: 'silent', dashboardEnabled: false,
      port: 3097, host: '127.0.0.1',
      telemetry: { enabled: true, installId: 'install-1', lastPingedVersion: pkgVersion },
    }
    mockSettings(settings)
    mockWriteConfig.mockResolvedValue(undefined)

    await startServer()

    expect(mockPingTelemetry).not.toHaveBeenCalled()
  })

  it('does not fire telemetry when disabled', async () => {
    const settings: any = {
      logLevel: 'silent', dashboardEnabled: false,
      port: 3096, host: '127.0.0.1',
      telemetry: { enabled: false },
    }
    mockSettings(settings)

    await startServer()

    expect(mockPingTelemetry).not.toHaveBeenCalled()
  })

  // Config migrations moved out of startServer() into configModule.migrate(),
  // which the kernel runs before any register(). Coverage lives in
  // modules/config/index.test.ts and core/lifecycle/kernel.test.ts.
  // Exception: migrateRouterStorage() and migrateUsageToNdjson() both run
  // directly in startServer(), before configModule.migrate(), so their
  // throws are fatal instead of swallowed by the kernel's best-effort catch
  // (RTR-01 finding B2, RTR-06 finding B1) — mocked above, coverage for the
  // real behaviour lives in server.migration-fatal.test.ts.

  it('migrates usage.json and logs the migrated record count on startup', async () => {
    mockMigrateUsage.mockResolvedValueOnce(42)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockSettings({ logLevel: 'silent', dashboardEnabled: false, port: 3094, host: '127.0.0.1', telemetry: { enabled: false } } as any)

    await startServer()

    expect(mockMigrateUsage).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('migrated 42 usage record'))
    logSpy.mockRestore()
  })

  it('propagates a fatal migrateUsageToNdjson() failure instead of starting the server (EC2)', async () => {
    mockMigrateUsage.mockRejectedValueOnce(new SyntaxError('Unexpected token in JSON'))
    mockSettings({ logLevel: 'silent', dashboardEnabled: false, port: 3093, host: '127.0.0.1', telemetry: { enabled: false } } as any)

    await expect(startServer()).rejects.toThrow('Unexpected token in JSON')

    expect(mockPingTelemetry).not.toHaveBeenCalled()
  })

  it('prunes orphan usage records on startup and logs when any removed (BUG-5)', async () => {
    const { pruneOrphanUsage } = await import('./modules/config/loader.js')
    vi.mocked(pruneOrphanUsage).mockResolvedValueOnce(18)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockSettings({ logLevel: 'silent', dashboardEnabled: false, port: 3095, host: '127.0.0.1', telemetry: { enabled: false } } as any)

    await startServer()

    expect(pruneOrphanUsage).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('pruned 18 orphan usage record'))
    logSpy.mockRestore()
  })
})
