import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./config/loader.js', () => ({
  initConfigDirs: vi.fn(),
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))
vi.mock('./plugins/jwt.js', () => ({
  loadSecret: vi.fn(),
  createSessionToken: vi.fn(() => 'token'),
  verifyToken: vi.fn(() => null),
  generateRawToken: vi.fn(() => 'raw'),
}))
vi.mock('./plugins/auth.js', () => ({ default: vi.fn(async () => {}) }))
vi.mock('./routes/openai.js', () => ({ openaiRoutes: vi.fn(async () => {}) }))
vi.mock('./routes/anthropic.js', () => ({ anthropicRoutes: vi.fn(async () => {}) }))
vi.mock('./routes/api.js', () => ({ apiRoutes: vi.fn(async () => {}) }))
vi.mock('./telemetry.js', () => ({ pingTelemetry: vi.fn() }))
vi.mock('./update-checker.js', () => ({
  updateChecker: { start: vi.fn(), check: vi.fn(), getLastResult: vi.fn(() => null), getAvailableReleases: vi.fn(() => []), updateChannel: vi.fn() }
}))

import { buildServer, startServer } from './server.js'
import { readConfig, writeConfig } from './config/loader.js'
import { pingTelemetry } from './telemetry.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)
const mockPingTelemetry = vi.mocked(pingTelemetry)

afterEach(() => vi.clearAllMocks())

describe('buildServer', () => {
  it('builds a Fastify instance with dashboard disabled', async () => {
    mockReadConfig.mockResolvedValue({ logLevel: 'silent', dashboardEnabled: false } as any)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/health' })
    await server.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('redirects GET / to /dashboard/', async () => {
    mockReadConfig.mockResolvedValue({ logLevel: 'silent', dashboardEnabled: false } as any)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/' })
    await server.close()

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('/dashboard/')
  })

  it('builds with dashboardEnabled:true (dashboard dist not found — catches error gracefully)', async () => {
    mockReadConfig.mockResolvedValue({ logLevel: 'silent', dashboardEnabled: true } as any)

    const server = await buildServer()
    await server.close()
  })
})

describe('startServer', () => {
  it('fires pingTelemetry install event on first start (no lastPingedVersion)', async () => {
    const settings: any = {
      logLevel: 'silent', dashboardEnabled: false,
      port: 3099, host: '127.0.0.1',
      telemetry: { enabled: true, installId: 'install-abc' },
    }
    mockReadConfig.mockResolvedValue(settings)
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
    mockReadConfig.mockResolvedValue(settings)
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
    mockReadConfig.mockResolvedValue(settings)
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
    mockReadConfig.mockResolvedValue(settings)

    await startServer()

    expect(mockPingTelemetry).not.toHaveBeenCalled()
  })
})
