import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'jwt'),
  verifyToken: vi.fn(() => ({ sub: 'u1' })),
  generateRawToken: vi.fn(() => 'r'),
}))
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
vi.mock('../trace/store.js', () => ({ getTrace: vi.fn() }))
vi.mock('../update-checker/update-checker.js', () => ({
  updateChecker: { getLastResult: vi.fn(() => null), check: vi.fn(), getAvailableReleases: vi.fn(() => []), updateChannel: vi.fn() },
}))
vi.mock('../telemetry/telemetry.js', () => ({ pingTelemetry: vi.fn() }))

import { readConfig, writeConfig } from '../config/loader.js'
import { logAudit } from '../audit/logger.js'
import { apiRoutes } from './api.js'
import { hashApiToken, warnExpiringApiTokens, API_TOKEN_PREFIX } from './api-tokens.js'

const mockRead = vi.mocked(readConfig as (k: string) => Promise<any>)
const mockWrite = vi.mocked(writeConfig as (k: string, v: any) => Promise<void>)

const RAW = `${API_TOKEN_PREFIX}${'a'.repeat(64)}`
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
let users: any[]

function token(over: Record<string, unknown> = {}) {
  return { id: 't1', name: 'ci', tokenHash: hashApiToken(RAW), tokenSnippet: RAW.slice(0, 14),
    createdAt: '2026-01-01T00:00:00.000Z', expiresAt: future(30), permissions: ['model:read'], ...over }
}

async function app() {
  const a = Fastify({ logger: false })
  await a.register(apiRoutes)
  await a.ready()
  return a
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

beforeEach(() => {
  vi.clearAllMocks()
  users = [{ id: 'u1', email: 'u@x.io', passwordHash: 'h', roleId: 'admin', routerIds: [], apiTokens: [token()] }]
  mockRead.mockImplementation(async (k: string) => (k === 'users' ? users : k === 'settings' ? {} : []) as never)
  mockWrite.mockResolvedValue(undefined)
})

describe('api token authentication', () => {
  it('allows an in-scope call and audits it with the token name', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/models', headers: bearer(RAW) })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'api_token:use', details: { tokenId: 't1', tokenName: 'ci' },
    }))
  })

  it('refuses an out-of-scope call with 403', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/users', headers: bearer(RAW) })
    expect(res.statusCode).toBe(403)
  })

  it('401 for unknown, revoked and expired tokens', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/models', headers: bearer(`${API_TOKEN_PREFIX}zzz`) })).statusCode).toBe(401)
    users[0].apiTokens = [token({ expiresAt: new Date(Date.now() - 1000).toISOString() })]
    expect((await a.inject({ method: 'GET', url: '/api/models', headers: bearer(RAW) })).statusCode).toBe(401)
    users[0].apiTokens = []
    expect((await a.inject({ method: 'GET', url: '/api/models', headers: bearer(RAW) })).statusCode).toBe(401)
  })

  it('scope is capped by the owner\'s current role', async () => {
    users[0].roleId = 'viewer'
    users[0].apiTokens = [token({ permissions: ['model:read', 'model:write'] })]
    const res = await (await app()).inject({ method: 'POST', url: '/api/models', headers: bearer(RAW), payload: {} })
    expect(res.statusCode).toBe(403)
  })

  it('cannot manage tokens or credentials, but may read /api/me with its expiry', async () => {
    const a = await app()
    users[0].apiTokens = [token({ permissions: ['model:read'] })]
    const mint = await a.inject({ method: 'POST', url: '/api/me/api-tokens', headers: bearer(RAW), payload: {} })
    expect(mint.statusCode).toBe(403)
    expect((await a.inject({ method: 'PUT', url: '/api/me', headers: bearer(RAW), payload: {} })).statusCode).toBe(403)
    expect((await a.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: bearer(RAW) })).statusCode).toBe(403)
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: bearer(RAW) })
    expect(me.statusCode).toBe(200)
    expect(me.json().tokenExpiresAt).toBe(users[0].apiTokens[0].expiresAt)
  })
})

describe('api token routes (session auth)', () => {
  const session = bearer('session-jwt')

  it('creates a token: value once, only the hash stored, audit has no secret', async () => {
    users[0].apiTokens = []
    const res = await (await app()).inject({ method: 'POST', url: '/api/me/api-tokens', headers: session,
      payload: { name: 'ci', expiresAt: future(30), permissions: ['model:read'] } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.token).toMatch(/^sk-rt-api-[0-9a-f]{64}$/)
    expect(body.tokenHash).toBeUndefined()
    const stored = (mockWrite.mock.calls[0]![1] as any[])[0].apiTokens[0]
    expect(stored.tokenHash).toBe(hashApiToken(body.token))
    expect(JSON.stringify(mockWrite.mock.calls)).not.toContain(body.token)
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain(body.token)
  })

  it.each([
    ['past expiry', { expiresAt: new Date(Date.now() - 1000).toISOString() }, 400],
    ['expiry beyond 365 days', { expiresAt: future(400) }, 400],
    ['missing scope', { permissions: [] }, 400],
    ['unknown permission', { permissions: ['nope'] }, 400],
  ])('rejects %s', async (_n, over, status) => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/me/api-tokens', headers: session,
      payload: { name: 'x', expiresAt: future(30), permissions: ['model:read'], ...over } })
    expect(res.statusCode).toBe(status)
  })

  it('refuses a scope the creator does not hold (403) and a duplicate name (409)', async () => {
    users[0].roleId = 'viewer'
    const a = await app()
    const denied = await a.inject({ method: 'POST', url: '/api/me/api-tokens', headers: session,
      payload: { name: 'x', expiresAt: future(30), permissions: ['user:write'] } })
    expect(denied.statusCode).toBe(403)
    const dup = await a.inject({ method: 'POST', url: '/api/me/api-tokens', headers: session,
      payload: { name: 'CI', expiresAt: future(30), permissions: ['model:read'] } })
    expect(dup.statusCode).toBe(409)
  })

  it('lists without hash, revokes (204) then 404', async () => {
    const a = await app()
    const list = await a.inject({ method: 'GET', url: '/api/me/api-tokens', headers: session })
    expect(list.json()).toHaveLength(1)
    expect(list.json()[0].tokenHash).toBeUndefined()
    expect((await a.inject({ method: 'DELETE', url: '/api/me/api-tokens/t1', headers: session })).statusCode).toBe(204)
    expect((await a.inject({ method: 'DELETE', url: '/api/me/api-tokens/t1', headers: session })).statusCode).toBe(404)
  })

  it('GET /api/users never leaks apiTokens', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/users', headers: session })
    expect(JSON.stringify(res.json())).not.toContain(hashApiToken(RAW))
  })
})

describe('warnExpiringApiTokens', () => {
  it('warns only for tokens expiring within 7 days', async () => {
    users[0].apiTokens = [token({ expiresAt: future(3) }), token({ id: 't2', name: 'far', expiresAt: future(60) })]
    const warn = vi.fn()
    expect(await warnExpiringApiTokens({ warn })).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ci"'))
  })
})
