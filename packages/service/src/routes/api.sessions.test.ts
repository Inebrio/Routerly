import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../modules/config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))
vi.mock('../modules/auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw-refresh-token-xxxx'),
}))
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
vi.mock('../modules/logging/traceStore.js', () => ({ getTrace: vi.fn() }))
vi.mock('../update-checker.js', () => ({
  updateChecker: { getLastResult: vi.fn(() => null), check: vi.fn(), getAvailableReleases: vi.fn(() => []), updateChannel: vi.fn() }
}))
vi.mock('../telemetry.js', () => ({ pingTelemetry: vi.fn() }))
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async (p: string) => `hashed:${p}`), compare: vi.fn() },
}))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-1234') }))

import { apiRoutes } from './api.js'
import { readConfig } from '../modules/config/loader.js'
import { verifyToken } from '../modules/auth/jwt.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockVerifyToken = vi.mocked(verifyToken)

afterEach(() => vi.clearAllMocks())

const adminUser: any = {
  id: 'admin-id', email: 'admin@example.com',
  passwordHash: '$2b$12$hashed', roleId: 'admin', projectIds: [],
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(apiRoutes)
  await app.ready()
  return app
}

function adminAuthHeaders() {
  return { authorization: 'Bearer valid-jwt-token' }
}

function setupAdminAuth() {
  mockVerifyToken.mockReturnValue({ sub: 'admin-id' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [adminUser]
    if (type === 'roles') return []
    return []
  })
}

function makeRecord(overrides: Record<string, any> = {}) {
  return {
    id: `rec-${Math.random()}`,
    timestamp: '2024-06-01T10:00:00.000Z',
    projectId: 'p1',
    modelId: 'm1',
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.01,
    outcome: 'success',
    callType: 'completion',
    latencyMs: 200,
    ...overrides,
  }
}

// ─── GET /api/sessions ────────────────────────────────────────────────────────

describe('GET /api/sessions', () => {
  it('returns empty sessions array when no records have sessionId', async () => {
    setupAdminAuth()
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return [makeRecord()]
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions', headers: adminAuthHeaders() })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.json().sessions).toEqual([])
  })

  it('groups records by sessionId and aggregates cost/tokens/requests', async () => {
    setupAdminAuth()
    const records = [
      makeRecord({ sessionId: 's1', inputTokens: 100, outputTokens: 50, cost: 0.01 }),
      makeRecord({ sessionId: 's1', inputTokens: 200, outputTokens: 100, cost: 0.02 }),
    ]
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions', headers: adminAuthHeaders() })
    await app.close()
    const { sessions } = res.json()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('s1')
    expect(sessions[0].requests).toBe(2)
    expect(sessions[0].totalCost).toBeCloseTo(0.03)
    expect(sessions[0].totalTokens).toBe(450)
  })

  it('sorts sessions by lastSeen descending', async () => {
    setupAdminAuth()
    const records = [
      makeRecord({ sessionId: 's-old', timestamp: '2024-01-01T00:00:00.000Z' }),
      makeRecord({ sessionId: 's-new', timestamp: '2024-06-01T00:00:00.000Z' }),
    ]
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions', headers: adminAuthHeaders() })
    await app.close()
    const { sessions } = res.json()
    expect(sessions[0].sessionId).toBe('s-new')
    expect(sessions[1].sessionId).toBe('s-old')
  })

  it('filters by projectId query param', async () => {
    setupAdminAuth()
    const records = [
      makeRecord({ sessionId: 's1', projectId: 'p1' }),
      makeRecord({ sessionId: 's2', projectId: 'p2' }),
    ]
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions?projectId=p1', headers: adminAuthHeaders() })
    await app.close()
    const { sessions } = res.json()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('s1')
  })

  it('respects limit param (default 20)', async () => {
    setupAdminAuth()
    const records = Array.from({ length: 25 }, (_, i) =>
      makeRecord({ sessionId: `s${i}`, timestamp: `2024-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
    )
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions', headers: adminAuthHeaders() })
    await app.close()
    const body = res.json()
    expect(body.sessions).toHaveLength(20)
    expect(body.nextCursor).toBeDefined()
  })

  it('returns nextCursor when there are more results', async () => {
    setupAdminAuth()
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ sessionId: `s${i}`, timestamp: `2024-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
    )
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions?limit=2', headers: adminAuthHeaders() })
    await app.close()
    const body = res.json()
    expect(body.sessions).toHaveLength(2)
    expect(body.nextCursor).toBeDefined()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions' })
    await app.close()
    expect(res.statusCode).toBe(401)
  })
})

// ─── GET /api/sessions/:id/requests ──────────────────────────────────────────

describe('GET /api/sessions/:id/requests', () => {
  it('returns requests for sessionId ordered by timestamp', async () => {
    setupAdminAuth()
    const records = [
      makeRecord({ sessionId: 's1', timestamp: '2024-06-01T12:00:00.000Z', id: 'r2' }),
      makeRecord({ sessionId: 's1', timestamp: '2024-06-01T10:00:00.000Z', id: 'r1' }),
      makeRecord({ sessionId: 's2', timestamp: '2024-06-01T11:00:00.000Z', id: 'r3' }),
    ]
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/requests', headers: adminAuthHeaders() })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sessionId).toBe('s1')
    expect(body.requests).toHaveLength(2)
    expect(body.requests[0].id).toBe('r1')
    expect(body.requests[1].id).toBe('r2')
  })

  it('returns 200 with empty array when no requests found for sessionId', async () => {
    setupAdminAuth()
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return [makeRecord({ sessionId: 'other' })]
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nonexistent/requests', headers: adminAuthHeaders() })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sessionId).toBe('nonexistent')
    expect(body.requests).toEqual([])
  })

  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/requests' })
    await app.close()
    expect(res.statusCode).toBe(401)
  })
})

// ─── GET /api/end-users ───────────────────────────────────────────────────────

describe('GET /api/end-users', () => {
  it('returns users aggregated from endUserId field', async () => {
    setupAdminAuth()
    const records = [
      makeRecord({ endUserId: 'u1', inputTokens: 100, outputTokens: 50, cost: 0.01 }),
      makeRecord({ endUserId: 'u1', inputTokens: 200, outputTokens: 100, cost: 0.02 }),
      makeRecord({ endUserId: 'u2', inputTokens: 50, outputTokens: 25, cost: 0.005 }),
    ]
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/end-users', headers: adminAuthHeaders() })
    await app.close()
    expect(res.statusCode).toBe(200)
    const { users } = res.json()
    expect(users).toHaveLength(2)
    const u1 = users.find((u: any) => u.userId === 'u1')!
    expect(u1.requests).toBe(2)
    expect(u1.totalCost).toBeCloseTo(0.03)
    expect(u1.totalTokens).toBe(450)
  })

  it('filters by projectId', async () => {
    setupAdminAuth()
    const records = [
      makeRecord({ endUserId: 'u1', projectId: 'p1' }),
      makeRecord({ endUserId: 'u2', projectId: 'p2' }),
    ]
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return records
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/end-users?projectId=p1', headers: adminAuthHeaders() })
    await app.close()
    const { users } = res.json()
    expect(users).toHaveLength(1)
    expect(users[0].userId).toBe('u1')
  })

  it('returns empty when no endUserId in records', async () => {
    setupAdminAuth()
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [adminUser]
      if (t === 'roles') return []
      if (t === 'usage') return [makeRecord()]
      return []
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/end-users', headers: adminAuthHeaders() })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.json().users).toEqual([])
  })

  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/end-users' })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks report:read permission', async () => {
    const noReportUser: any = { id: 'noreport-id', email: 'noreport@example.com', passwordHash: 'x', roleId: 'no-report', projectIds: [] }
    mockVerifyToken.mockReturnValue({ sub: 'noreport-id' } as any)
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [noReportUser]
      if (t === 'roles') return [{ id: 'no-report', name: 'No Report', permissions: ['project:read'] }]
      return []
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/end-users', headers: { authorization: 'Bearer tok' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})
