import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => {
  class ConfigUpdateAbort extends Error {
    constructor(public readonly status: number, public readonly body: unknown) {
      super(`config update aborted (status ${status})`)
    }
  }
  const readConfig = vi.fn()
  const writeConfig = vi.fn()
  const updateConfig = vi.fn(async (key: string, mutate: (current: unknown) => unknown | Promise<unknown>) => {
    const current = await readConfig(key)
    const next = await mutate(current)
    if (next !== current) await writeConfig(key, next)
    return next
  })
  return { readConfig, writeConfig, updateConfig, ConfigUpdateAbort, getOrCreateSecret: vi.fn(), effectivePort: (s: { port: number }) => s.port }
})
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw-refresh-token-xxxx'),
}))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../config/permission-guard.js', () => ({
  checkPermissions: vi.fn().mockResolvedValue({ blocked: false, bypassActive: false, unsafe: [] }),
  fixPermissions: vi.fn().mockResolvedValue([]),
  isBypassActive: vi.fn().mockReturnValue(false),
}))

import { apiRoutes } from './api.js'
import { readConfig, writeConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockWriteConfig = vi.mocked(writeConfig as (key: string, value: any) => Promise<void>)
const mockVerifyToken = vi.mocked(verifyToken)

afterEach(() => vi.clearAllMocks())
beforeEach(() => { mockReadConfig.mockImplementation(async () => []) })

const CONFIG = {
  enabled: true,
  clientValues: { effort: 'override' },
  tiers: { low: { effort: 'low', maxOutputTokens: 256, verbosity: 'low' }, high: { effort: 'high', maxOutputTokens: 4096 } },
  thresholds: { mediumFromTokens: 1000, highFromTokens: 8000 },
}
const storedRouter = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', name: 'R', tokens: [], members: [], models: [], policies: [], ...extra,
})

/** One permission through a custom role; `routers` seeds the stored routers. */
function authWith(perm: string, routers: unknown[] = []) {
  mockVerifyToken.mockReturnValue({ sub: 'u1' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [{ id: 'u1', email: 'u@x.io', roleId: 'role1', routerIds: [] }]
    if (type === 'roles') return [{ id: 'role1', name: 'T', permissions: [perm] }]
    if (type === 'routers') return routers
    return []
  })
  mockWriteConfig.mockResolvedValue(undefined)
  return { authorization: 'Bearer jwt', 'content-type': 'application/json' }
}

async function call(method: 'POST' | 'PUT', url: string, headers: Record<string, string>, payload: unknown) {
  const app = Fastify({ logger: false })
  await app.register(apiRoutes)
  await app.ready()
  const res = await app.inject({ method, url, headers, payload: JSON.stringify(payload) })
  await app.close()
  return res
}

const lastWrittenRouters = () => {
  const call = mockWriteConfig.mock.calls.filter(c => c[0] === 'routers').at(-1)
  return call?.[1] as any[]
}

describe('POST /api/routers — callConfig', () => {
  it('stores a valid callConfig (200 family, router:write)', async () => {
    const res = await call('POST', '/api/routers', authWith('router:write'), { name: 'New', callConfig: CONFIG })
    expect(res.statusCode).toBe(201)
    expect(res.json().callConfig).toEqual(CONFIG)
    expect(lastWrittenRouters()[0].callConfig).toEqual(CONFIG)
  })

  it('stores nothing when callConfig is absent or null', async () => {
    for (const body of [{ name: 'A' }, { name: 'B', callConfig: null }]) {
      const res = await call('POST', '/api/routers', authWith('router:write'), body)
      expect(res.statusCode).toBe(201)
      expect('callConfig' in res.json()).toBe(false)
    }
  })

  it('rejects an invalid callConfig with 400', async () => {
    const res = await call('POST', '/api/routers', authWith('router:write'), { name: 'X', callConfig: { enabled: true, tiers: { low: { maxOutputTokens: 4 } } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid callConfig')
    expect(res.json().details).toBeDefined()
  })

  it('returns 403 without router:write', async () => {
    const res = await call('POST', '/api/routers', authWith('router:read'), { name: 'X', callConfig: CONFIG })
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /api/routers/:id — callConfig', () => {
  it('keeps the stored callConfig when the field is omitted', async () => {
    const res = await call('PUT', '/api/routers/r1', authWith('router:write', [storedRouter({ callConfig: CONFIG })]), { name: 'R2' })
    expect(res.statusCode).toBe(200)
    expect(res.json().callConfig).toEqual(CONFIG)
  })

  it('replaces it with a valid object', async () => {
    const next = { enabled: false, tiers: {} }
    const res = await call('PUT', '/api/routers/r1', authWith('router:write', [storedRouter({ callConfig: CONFIG })]), { callConfig: next })
    expect(res.statusCode).toBe(200)
    expect(lastWrittenRouters()[0].callConfig).toEqual(next)
  })

  it('removes the key on null', async () => {
    const res = await call('PUT', '/api/routers/r1', authWith('router:write', [storedRouter({ callConfig: CONFIG })]), { callConfig: null })
    expect(res.statusCode).toBe(200)
    expect('callConfig' in lastWrittenRouters()[0]).toBe(false)
    expect('callConfig' in res.json()).toBe(false)
  })

  it.each([
    ['unknown key', { enabled: true, tiers: {}, extra: 1 }],
    ['missing enabled', { tiers: {} }],
    ['bad effort', { enabled: true, tiers: { low: { effort: 'max' } } }],
    ['maxOutputTokens above range', { enabled: true, tiers: { low: { maxOutputTokens: 1_000_001 } } }],
    ['unknown tier', { enabled: true, tiers: { huge: {} } }],
    ['bad clientValues policy', { enabled: true, tiers: {}, clientValues: { effort: 'always' } }],
    ['medium threshold not below high', { enabled: true, tiers: {}, thresholds: { mediumFromTokens: 17000 } }],
  ])('rejects %s with 400 and writes nothing', async (_name, callConfig) => {
    const res = await call('PUT', '/api/routers/r1', authWith('router:write', [storedRouter()]), { callConfig })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid callConfig')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('returns 403 without router:write', async () => {
    const res = await call('PUT', '/api/routers/r1', authWith('router:read', [storedRouter()]), { callConfig: CONFIG })
    expect(res.statusCode).toBe(403)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})
