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

const PT = '__passthrough__'
const storedRouter = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', name: 'R', kind: 'passthrough', tokens: [], members: [], policies: [],
  models: [{ modelId: PT }, { modelId: 'm1' }, { modelId: 'm2' }], ...extra,
})
const RULES = [{ match: 'gpt-4o', targetModelId: 'm1' }, { match: 'claude-*', targetModelId: 'm2' }]

/** One permission through a custom role; `extra` seeds other config keys. */
function authWith(perm: string, routers: unknown[] = [], extra: Record<string, unknown[]> = {}) {
  mockVerifyToken.mockReturnValue({ sub: 'u1' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [{ id: 'u1', email: 'u@x.io', roleId: 'role1', routerIds: [] }]
    if (type === 'roles') return [{ id: 'role1', name: 'T', permissions: [perm] }]
    if (type === 'routers') return routers
    return extra[type] ?? []
  })
  mockWriteConfig.mockResolvedValue(undefined)
  return { authorization: 'Bearer jwt', 'content-type': 'application/json' }
}

async function put(url: string, headers: Record<string, string>, payload: unknown) {
  const app = Fastify({ logger: false })
  await app.register(apiRoutes)
  await app.ready()
  const res = await app.inject({ method: 'PUT', url, headers, payload: JSON.stringify(payload) })
  await app.close()
  return res
}

const lastWrittenRouters = () => {
  const call = mockWriteConfig.mock.calls.filter(c => c[0] === 'routers').at(-1)
  return call?.[1] as any[]
}

describe('PUT /api/routers/:id — passthrough exceptions', () => {
  it('operator (router:write) replaces the list: 200, stored and returned', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { exceptions: RULES })
    expect(res.statusCode).toBe(200)
    expect(res.json().exceptions).toEqual(RULES)
    expect(lastWrittenRouters()[0].exceptions).toEqual(RULES)
  })

  it('viewer (router:read only) gets 403 and nothing is written', async () => {
    const res = await put('/api/routers/r1', authWith('router:read', [storedRouter()]), { exceptions: RULES })
    expect(res.statusCode).toBe(403)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('omitted keeps the stored list; [] clears it and drops the key', async () => {
    const kept = await put('/api/routers/r1', authWith('router:write', [storedRouter({ exceptions: RULES })]), { name: 'R2' })
    expect(kept.json().exceptions).toEqual(RULES)
    const cleared = await put('/api/routers/r1', authWith('router:write', [storedRouter({ exceptions: RULES })]), { exceptions: [] })
    expect(cleared.statusCode).toBe(200)
    expect('exceptions' in cleared.json()).toBe(false)
    expect('exceptions' in lastWrittenRouters()[0]).toBe(false)
  })

  it('a router without exceptions round-trips without gaining the key', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { name: 'R2' })
    expect(res.statusCode).toBe(200)
    expect('exceptions' in lastWrittenRouters()[0]).toBe(false)
  })

  it('trims the match before storing', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { exceptions: [{ match: '  gpt-4o ', targetModelId: 'm1' }] })
    expect(res.statusCode).toBe(200)
    expect(res.json().exceptions).toEqual([{ match: 'gpt-4o', targetModelId: 'm1' }])
  })

  it.each([
    ['empty match', [{ match: '   ', targetModelId: 'm1' }]],
    ['match over 200 chars', [{ match: 'a'.repeat(201), targetModelId: 'm1' }]],
    ['empty target', [{ match: 'x', targetModelId: '' }]],
    ['unknown key', [{ match: 'x', targetModelId: 'm1', extra: 1 }]],
    ['more than 50 rules', Array.from({ length: 51 }, (_, i) => ({ match: `m${i}`, targetModelId: 'm1' }))],
    ['not an array', { match: 'x', targetModelId: 'm1' }],
  ])('Zod: rejects %s with 400 and writes nothing', async (_n, exceptions) => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { exceptions })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid exceptions')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('rejects a target that is not a model of the router', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { exceptions: [{ match: 'a', targetModelId: 'm1' }, { match: 'b', targetModelId: 'foreign' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Exception #1: target "foreign" is not a model of this router' })
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('rejects the sentinel as a target', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { exceptions: [{ match: 'a', targetModelId: PT }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe(`Exception #0: target "${PT}" is not a model of this router`)
  })

  it('rejects a duplicate match', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter()]), { exceptions: [{ match: 'a', targetModelId: 'm1' }, { match: 'a', targetModelId: 'm2' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Exception #1: duplicate match "a"' })
  })

  it('rejects exceptions on a router-kind router', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter({ kind: undefined, models: [{ modelId: 'm1' }] })]), { exceptions: RULES })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Exceptions are only supported on passthrough routers' })
  })

  it('rejects a models edit that drops a targeted model', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter({ exceptions: RULES })]), { models: [{ modelId: PT }, { modelId: 'm1' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Exception #1: target "m2" is not a model of this router' })
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('switching the kind away from passthrough drops the stored exceptions', async () => {
    const res = await put('/api/routers/r1', authWith('router:write', [storedRouter({ exceptions: RULES })]), { kind: 'router' })
    expect(res.statusCode).toBe(200)
    expect('exceptions' in res.json()).toBe(false)
    expect('exceptions' in lastWrittenRouters()[0]).toBe(false)
  })
})

describe('POST /api/routers — exceptions', () => {
  it('does not store an exceptions field sent on creation', async () => {
    const app = Fastify({ logger: false })
    await app.register(apiRoutes)
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/api/routers', headers: authWith('router:write'),
      payload: JSON.stringify({ name: 'New', kind: 'passthrough', exceptions: RULES }),
    })
    await app.close()
    expect(res.statusCode).toBe(201)
    expect('exceptions' in lastWrittenRouters()[0]).toBe(false)
  })
})

describe('PUT /api/models/:id — rename cascades into exceptions', () => {
  it('renames the target of every rule that points at the model', async () => {
    const instance = { id: 'm1', connectionId: 'conn-m1', upstreamModelId: 'm1', cost: { inputPerMillion: 1, outputPerMillion: 1 }, contextWindow: 0 }
    const connection = { id: 'conn-m1', providerId: 'openai', label: 'm1', credentials: {}, endpoint: 'https://api.openai.com/v1', enabled: true }
    const res = await put('/api/models/m1', authWith('model:write', [storedRouter({ exceptions: RULES })], { instances: [instance], connections: [connection] }), {
      id: 'm1-renamed', provider: 'openai', endpoint: 'https://api.openai.com/v1', inputPerMillion: 1, outputPerMillion: 1,
    })
    expect(res.statusCode).toBe(200)
    const stored = lastWrittenRouters()[0]
    expect(stored.exceptions).toEqual([{ match: 'gpt-4o', targetModelId: 'm1-renamed' }, { match: 'claude-*', targetModelId: 'm2' }])
    expect(stored.models.map((m: { modelId: string }) => m.modelId)).toContain('m1-renamed')
  })
})
