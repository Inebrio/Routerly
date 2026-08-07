import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

// Mirrors modules/api/connections.test.ts's mock set — apiRoutes (mounted below) imports all of
// these at module scope, and several run non-blocking IO at plugin-registration time.
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn(), getOrCreateSecret: vi.fn() }))
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw-refresh-token-xxxx'),
}))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-1234') }))
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async (p: string) => `hashed:${p}`), compare: vi.fn() },
}))

import { apiRoutes } from '../api/api.js'
import { apiModule } from '../api/index.js'
import { resilienceModule } from './index.js'
import { RESILIENCE_STORE } from '../../core/tokens.js'
import { buildKernel } from '../../core/lifecycle/bootstrap.js'
import { readConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockVerifyToken = vi.mocked(verifyToken)

afterEach(() => vi.clearAllMocks())

// Baseline so plugin registration (which reads 'settings' at boot) never sees an un-mocked
// readConfig — per-test auth() below replaces it before the actual request is dispatched.
beforeEach(() => {
  mockReadConfig.mockImplementation(async () => [])
})

const testUser = { id: 'test-user-id', email: 'test@example.com', roleId: 'test-role', routerIds: [] }

/** Parameterized auth header helper: grants exactly one permission via a custom role. */
function auth(perm: string) {
  mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [testUser]
    if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: [perm] }]
    return []
  })
  return { authorization: 'Bearer valid-jwt-token' }
}

/**
 * Builds the real kernel (apiModule + resilienceModule only — the rest of ALL_MODULES isn't
 * needed and would drag in unrelated config reads) and mounts apiRoutes exactly like server.ts's
 * buildServer() does, so GET /api/resilience and POST /api/resilience/reset are reached through
 * the real API_ROUTES contribution path (G3 module gating), not a hand-mounted mini app.
 */
async function buildApp() {
  const kernel = await buildKernel([apiModule, resilienceModule])
  const app = Fastify({ logger: false })
  app.decorate('kernel', kernel)
  await app.register(apiRoutes)
  await app.ready()
  return { app, kernel }
}

describe('GET /api/resilience', () => {
  it('allows with resilience:read and returns the store snapshot', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/resilience', headers: auth('resilience:read') })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('entries')
    expect(body).toHaveProperty('generatedAt')
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('forbids without resilience:read', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/resilience', headers: auth('resilience:manage') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/resilience/reset', () => {
  it('allows with resilience:manage and actually clears the store', async () => {
    const { app, kernel } = await buildApp()
    const store = kernel.container.resolve(RESILIENCE_STORE)
    store.record({ level: 'provider', id: 'openai' }, { category: 'server' })
    expect(store.snapshot().entries).toHaveLength(1)

    const res = await app.inject({
      method: 'POST', url: '/api/resilience/reset', headers: auth('resilience:manage'), payload: {},
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(store.snapshot().entries).toHaveLength(0)
  })

  it('resets a single key when level+id are both supplied', async () => {
    const { app, kernel } = await buildApp()
    const store = kernel.container.resolve(RESILIENCE_STORE)
    store.record({ level: 'provider', id: 'openai' }, { category: 'server' })
    store.record({ level: 'provider', id: 'anthropic' }, { category: 'server' })
    expect(store.snapshot().entries).toHaveLength(2)

    const res = await app.inject({
      method: 'POST', url: '/api/resilience/reset', headers: auth('resilience:manage'),
      payload: { level: 'provider', id: 'openai' },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const remaining = store.snapshot().entries
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.key).toEqual({ level: 'provider', id: 'anthropic' })
  })

  it('forbids without resilience:manage', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/resilience/reset', headers: auth('resilience:read'), payload: {},
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('rejects a malformed body (invalid level enum)', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/resilience/reset', headers: auth('resilience:manage'),
      payload: { level: 'not-a-real-level' },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('rejects a partial body with only level (no id)', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/resilience/reset', headers: auth('resilience:manage'),
      payload: { level: 'provider' },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('rejects a partial body with only id (no level)', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/resilience/reset', headers: auth('resilience:manage'),
      payload: { id: 'openai' },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})
