import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
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

import { apiRoutes } from './api.js'
import { readConfig, writeConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
vi.mocked(writeConfig as (key: string, value: any) => Promise<void>)
const mockVerifyToken = vi.mocked(verifyToken)

afterEach(() => vi.clearAllMocks())

// Baseline so plugin registration (which reads 'settings' at boot) never sees
// an un-mocked readConfig — set before each test, per-test auth()/overrides
// below replace it before the actual request is dispatched.
beforeEach(() => {
  mockReadConfig.mockImplementation(async () => [])
})

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(apiRoutes)
  await app.ready()
  return app
}

const testUser = { id: 'test-user-id', email: 'test@example.com', roleId: 'test-role', projectIds: [] }

/** Parameterized auth header helper: grants exactly one permission via a custom role. */
function auth(perm: string) {
  mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [testUser]
    if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: [perm] }]
    if (type === 'connections') return []
    if (type === 'instances') return []
    return []
  })
  return { authorization: 'Bearer valid-jwt-token' }
}

// ─── Step 7.1 ────────────────────────────────────────────────────────────────

describe('POST /api/connections', () => {
  it('allows POST /api/connections with connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/connections', headers: auth('connections:manage'),
      payload: { providerId: 'openai', label: 'Main', credentials: { apiKey: 'sk' }, enabled: true },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
  })

  it('forbids POST /api/connections without permission', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/connections', headers: auth('model:read'),
      payload: { providerId: 'openai', label: 'Main', credentials: { apiKey: 'sk' }, enabled: true },
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('rejects unknown providerId via descriptor registry', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/connections', headers: auth('connections:manage'),
      payload: { providerId: 'nope', label: 'x', credentials: {}, enabled: true },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('never echoes credentials on success', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/connections', headers: auth('connections:manage'),
      payload: { providerId: 'openai', label: 'Main', credentials: { apiKey: 'sk-secret' }, enabled: true },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.credentials).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('sk-secret')
  })
})

// ─── GET /api/providers/descriptors ─────────────────────────────────────────

describe('GET /api/providers/descriptors', () => {
  it('allows with connections:read and returns a non-empty list', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/providers/descriptors', headers: auth('connections:read') })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body.some((d: any) => d.id === 'openai')).toBe(true)
  })

  it('forbids without connections:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/providers/descriptors', headers: auth('model:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

// ─── GET /api/connections ────────────────────────────────────────────────────

describe('GET /api/connections', () => {
  it('allows with connections:read and redacts credentials', async () => {
    const app = await buildApp()
    mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
    const headers = auth('connections:read')
    mockReadConfig.mockImplementation(async (type: string) => {
      if (type === 'users') return [testUser]
      if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: ['connections:read'] }]
      if (type === 'connections') return [{ id: 'c1', providerId: 'openai', label: 'Main', credentials: { apiKey: 'secret' }, enabled: true }]
      return []
    })
    const res = await app.inject({ method: 'GET', url: '/api/connections', headers })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(1)
    expect(body[0].credentials).toBeUndefined()
  })

  it('forbids without connections:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/connections', headers: auth('model:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

// ─── PATCH /api/connections/:id ──────────────────────────────────────────────

describe('PATCH /api/connections/:id', () => {
  it('allows with connections:manage and applies partial update', async () => {
    const app = await buildApp()
    mockReadConfig.mockImplementation(async (type: string) => {
      if (type === 'users') return [testUser]
      if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: ['connections:manage'] }]
      if (type === 'connections') return [{ id: 'c1', providerId: 'openai', label: 'Old', credentials: { apiKey: 'a' }, enabled: true }]
      return []
    })
    mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
    const res = await app.inject({
      method: 'PATCH', url: '/api/connections/c1', headers: { authorization: 'Bearer valid-jwt-token' },
      payload: { label: 'New' },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.label).toBe('New')
    expect(body.credentials).toBeUndefined()
  })

  it('forbids without connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/connections/c1', headers: auth('connections:read'),
      payload: { label: 'New' },
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for unknown id', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/connections/nope', headers: auth('connections:manage'),
      payload: { label: 'New' },
    })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('rejects invalid body (label not a string)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/connections/c1', headers: auth('connections:manage'),
      payload: { label: 123 },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/connections/:id ─────────────────────────────────────────────

describe('DELETE /api/connections/:id', () => {
  it('allows with connections:manage', async () => {
    const app = await buildApp()
    mockReadConfig.mockImplementation(async (type: string) => {
      if (type === 'users') return [testUser]
      if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: ['connections:manage'] }]
      if (type === 'connections') return [{ id: 'c1', providerId: 'openai', label: 'Main', credentials: {}, enabled: true }]
      return []
    })
    mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
    const res = await app.inject({ method: 'DELETE', url: '/api/connections/c1', headers: { authorization: 'Bearer valid-jwt-token' } })
    await app.close()
    expect(res.statusCode).toBe(204)
  })

  it('forbids without connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/connections/c1', headers: auth('connections:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for unknown id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/connections/nope', headers: auth('connections:manage') })
    await app.close()
    expect(res.statusCode).toBe(404)
  })
})

// ─── GET /api/instances ──────────────────────────────────────────────────────

describe('GET /api/instances', () => {
  it('allows with connections:read', async () => {
    const app = await buildApp()
    mockReadConfig.mockImplementation(async (type: string) => {
      if (type === 'users') return [testUser]
      if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: ['connections:read'] }]
      if (type === 'instances') return [{ id: 'i1', connectionId: 'c1', upstreamModelId: 'gpt-4o', cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 128000 }]
      return []
    })
    mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
    const res = await app.inject({ method: 'GET', url: '/api/instances', headers: { authorization: 'Bearer valid-jwt-token' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(1)
  })

  it('forbids without connections:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/instances', headers: auth('model:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

// ─── POST /api/instances ─────────────────────────────────────────────────────

describe('POST /api/instances', () => {
  const validBody = {
    connectionId: 'c1',
    upstreamModelId: 'gpt-4o',
    cost: { inputPerMillion: 1, outputPerMillion: 2 },
    contextWindow: 128000,
  }

  it('allows with connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/instances', headers: auth('connections:manage'), payload: validBody })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe('test-uuid-1234')
    expect(body.contextWindow).toBe(128000)
  })

  it('forbids without connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/instances', headers: auth('connections:read'), payload: validBody })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('rejects invalid body (missing contextWindow)', async () => {
    const app = await buildApp()
    const { contextWindow: _cw, ...invalid } = validBody
    const res = await app.inject({ method: 'POST', url: '/api/instances', headers: auth('connections:manage'), payload: invalid })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── PATCH /api/instances/:id ─────────────────────────────────────────────────

describe('PATCH /api/instances/:id', () => {
  it('allows with connections:manage and applies partial update', async () => {
    const app = await buildApp()
    mockReadConfig.mockImplementation(async (type: string) => {
      if (type === 'users') return [testUser]
      if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: ['connections:manage'] }]
      if (type === 'instances') return [{ id: 'i1', connectionId: 'c1', upstreamModelId: 'gpt-4o', cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 128000 }]
      return []
    })
    mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
    const res = await app.inject({
      method: 'PATCH', url: '/api/instances/i1', headers: { authorization: 'Bearer valid-jwt-token' },
      payload: { contextWindow: 200000 },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contextWindow).toBe(200000)
  })

  it('forbids without connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/instances/i1', headers: auth('connections:read'),
      payload: { contextWindow: 200000 },
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for unknown id', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/instances/nope', headers: auth('connections:manage'),
      payload: { contextWindow: 200000 },
    })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('rejects invalid body (contextWindow not a number)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/instances/i1', headers: auth('connections:manage'),
      payload: { contextWindow: 'not-a-number' },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/instances/:id ────────────────────────────────────────────────

describe('DELETE /api/instances/:id', () => {
  it('allows with connections:manage', async () => {
    const app = await buildApp()
    mockReadConfig.mockImplementation(async (type: string) => {
      if (type === 'users') return [testUser]
      if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: ['connections:manage'] }]
      if (type === 'instances') return [{ id: 'i1', connectionId: 'c1', upstreamModelId: 'gpt-4o', cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 128000 }]
      return []
    })
    mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
    const res = await app.inject({ method: 'DELETE', url: '/api/instances/i1', headers: { authorization: 'Bearer valid-jwt-token' } })
    await app.close()
    expect(res.statusCode).toBe(204)
  })

  it('forbids without connections:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/instances/i1', headers: auth('connections:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for unknown id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/instances/nope', headers: auth('connections:manage') })
    await app.close()
    expect(res.statusCode).toBe(404)
  })
})

