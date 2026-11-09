import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw-refresh-token-xxxx'),
}))
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
vi.mock('../trace/store.js', () => ({ getTrace: vi.fn() }))
vi.mock('../update-checker/update-checker.js', () => ({
  updateChecker: { getLastResult: vi.fn(() => null), check: vi.fn(), getAvailableReleases: vi.fn(() => []), updateChannel: vi.fn() }
}))
vi.mock('../telemetry/telemetry.js', () => ({ pingTelemetry: vi.fn() }))
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async (p: string) => `hashed:${p}`), compare: vi.fn() },
}))
vi.mock('../usage/activity.js', () => ({ readActivity: vi.fn() }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-1234') }))

import { apiRoutes } from './api.js'
import { readConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'
import { readActivity } from '../usage/activity.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockVerifyToken = vi.mocked(verifyToken)
const mockReadActivity = vi.mocked(readActivity)

afterEach(() => vi.clearAllMocks())

const adminUser: any = {
  id: 'admin-id', email: 'admin@example.com',
  passwordHash: '$2b$12$hashed', roleId: 'admin', routerIds: [],
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
    routerId: 'p1',
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


const T = (s: string) => `2024-01-01T10:00:${s}.000Z`

function setupData(usage: any[], activity: any[] = []) {
  setupAdminAuth()
  mockReadConfig.mockImplementation(async (t: string) => {
    if (t === 'users') return [adminUser]
    if (t === 'roles') return []
    if (t === 'usage') return usage
    return []
  })
  mockReadActivity.mockResolvedValue(activity)
}

const get = async (url: string) => {
  const app = await buildApp()
  const res = await app.inject({ method: 'GET', url, headers: adminAuthHeaders() })
  await app.close()
  return res
}

const fallbackUsage = () => [
  makeRecord({ id: 'rt', traceId: 'tr1', callType: 'routing', timestamp: T('01'), cost: 0.002 }),
  makeRecord({ id: 'a1', traceId: 'tr1', timestamp: T('02'), outcome: 'error', cost: 0, errorMessage: 'boom',
    trace: [{ panel: 'p', message: 'm', details: { a: 1 }, content: { prompt: 'SECRET' } }] }),
  makeRecord({ id: 'a2', traceId: 'tr1', timestamp: T('03'), cost: 0.05, tokenId: 'tk1', sessionId: 's1' }),
  makeRecord({ id: 'solo', timestamp: T('04'), cost: null, routerId: 'p2', endUserId: 'eu1' }),
]

describe('GET /api/timeline', () => {
  it('returns 403 for a user without report:read', async () => {
    mockVerifyToken.mockReturnValue({ sub: 'np' } as any)
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [{ id: 'np', email: 'np@example.com', passwordHash: 'h', roleId: 'noperm', routerIds: [] }]
      if (t === 'roles') return [{ id: 'noperm', name: 'NoPerm', permissions: [] }]
      return []
    })
    const res = await get('/api/timeline')
    expect(res.statusCode).toBe(403)
    expect(mockReadActivity).not.toHaveBeenCalled()
  })

  it('returns 200 for report:read and puts a fallback request in ONE group (AC1)', async () => {
    setupData(fallbackUsage())
    const res = await get('/api/timeline?period=all')
    expect(res.statusCode).toBe(200)
    const { groups } = res.json()
    const g = groups.find((x: any) => x.id === 'tr1')
    expect(g.events.map((e: any) => [e.recordId, e.kind, e.attempt, e.final])).toEqual([
      ['rt', 'routing', undefined, undefined], ['a1', 'attempt', 1, undefined], ['a2', 'attempt', 2, true],
    ])
    expect(g).toMatchObject({ fallback: true, attempts: 2, outcome: 'success', correlated: true })
    expect(groups).toHaveLength(2)
  })

  it('totals.cost equals /api/usage summary.totalCost for the same filters (AC5)', async () => {
    const usage = fallbackUsage()
    setupData(usage, [{ id: 'ac', timestamp: T('05'), kind: 'mcp', outcome: 'success', durationMs: 3, name: 'x' }])
    for (const q of ['period=all', 'period=all&routerId=p1', 'period=all&tokenIds=tk1', 'period=all&sessionId=s1']) {
      const t = (await get(`/api/timeline?${q}`)).json()
      const u = (await get(`/api/usage?${q}`)).json()
      expect(t.totals.cost).toBeCloseTo(u.summary.totalCost, 10)
    }
  })

  it('unknown cost is null, never 0 (AC4)', async () => {
    setupData(fallbackUsage())
    const g = (await get('/api/timeline?period=all')).json().groups.find((x: any) => x.id === 'solo')
    expect(g.cost).toBeNull()
    expect(g.events[0].cost).toBeNull()
  })

  it('merges activity events (mcp, proxy) as single uncorrelated groups (AC2)', async () => {
    setupData([], [
      { id: 'm1', timestamp: T('01'), kind: 'mcp', outcome: 'success', durationMs: 5, name: 'list_routers', userId: 'u1' },
      { id: 'p1', timestamp: T('02'), kind: 'proxy', outcome: 'success', durationMs: 7, name: 'GET /v1/models', status: 200, routerId: 'r9', tokenId: 'tk9' },
    ])
    const { groups, totals } = (await get('/api/timeline?period=all')).json()
    expect(groups.map((g: any) => [g.events[0].kind, g.events[0].name, g.correlated])).toEqual([
      ['proxy', 'GET /v1/models', false], ['mcp', 'list_routers', false],
    ])
    expect(totals).toMatchObject({ groups: 2, events: 2, eventsByKind: { mcp: 1, proxy: 1 } })
  })

  it('filters by routerId, tokenId, kind, outcome and session/end-user (AC6)', async () => {
    const act = [{ id: 'p1', timestamp: T('06'), kind: 'proxy', outcome: 'error', durationMs: 7, name: 'GET /v1/models', status: 502, routerId: 'p1', tokenId: 'tk1' }]
    setupData(fallbackUsage(), act)
    const ids = async (q: string) => (await get(`/api/timeline?period=all&${q}`)).json().groups.map((g: any) => g.id)
    expect(await ids('routerId=p2')).toEqual(['solo'])
    expect(await ids('tokenId=tk1')).toEqual(['p1', 'tr1'])
    expect(await ids('kind=routing')).toEqual(['tr1'])
    expect(await ids('kind=proxy')).toEqual(['p1'])
    expect(await ids('outcome=error')).toEqual(['p1'])
    expect(await ids('sessionId=s1')).toEqual(['tr1'])
    expect(await ids('endUserId=eu1')).toEqual(['solo'])
  })

  it('applies the period window like /api/usage: custom from/to', async () => {
    setupData([makeRecord({ id: 'in', timestamp: '2024-06-01T10:00:00.000Z' }), makeRecord({ id: 'out', timestamp: '2023-01-01T10:00:00.000Z' })])
    const res = await get('/api/timeline?period=custom&from=2024-06-01&to=2024-06-01')
    expect(res.json().groups.map((g: any) => g.id)).toEqual(['in'])
  })

  it('rejects an unknown kind or outcome with 400', async () => {
    setupData([])
    expect((await get('/api/timeline?kind=nope')).statusCode).toBe(400)
    expect((await get('/api/timeline?outcome=nope')).statusCode).toBe(400)
  })

  it('paginates groups', async () => {
    setupData(Array.from({ length: 5 }, (_, i) => makeRecord({ id: `r${i}`, timestamp: T(`0${i}`) })))
    const r = (await get('/api/timeline?period=all&pageSize=2&page=2')).json()
    expect(r.groups).toHaveLength(2)
    expect(r.pagination).toEqual({ page: 2, pageSize: 2, totalRecords: 5, totalPages: 3 })
    expect(r.totals.groups).toBe(5)
  })
})

describe('GET /api/timeline/:id', () => {
  it('returns 403 for a user without report:read', async () => {
    mockVerifyToken.mockReturnValue({ sub: 'np' } as any)
    mockReadConfig.mockImplementation(async (t: string) => {
      if (t === 'users') return [{ id: 'np', email: 'np@example.com', passwordHash: 'h', roleId: 'noperm', routerIds: [] }]
      if (t === 'roles') return [{ id: 'noperm', name: 'NoPerm', permissions: [] }]
      return []
    })
    expect((await get('/api/timeline/tr1')).statusCode).toBe(403)
  })

  it('returns the group with trace entries per event and strips prompt/response content (AC7)', async () => {
    setupData(fallbackUsage())
    const res = await get('/api/timeline/tr1')
    expect(res.statusCode).toBe(200)
    const g = res.json()
    expect(g.events).toHaveLength(3)
    const failed = g.events.find((e: any) => e.recordId === 'a1')
    expect(failed.trace).toEqual([{ panel: 'p', message: 'm', details: { a: 1 } }])
    expect(failed.errorMessage).toBe('boom')
    expect(res.body).not.toContain('SECRET')
  })

  it('resolves an uncorrelated record and an activity event by id', async () => {
    setupData(fallbackUsage(), [{ id: 'm1', timestamp: T('01'), kind: 'mcp', outcome: 'success', durationMs: 5, name: 'list_routers' }])
    expect((await get('/api/timeline/solo')).json()).toMatchObject({ id: 'solo', correlated: false })
    expect((await get('/api/timeline/m1')).json().events[0]).toMatchObject({ kind: 'mcp', name: 'list_routers' })
  })

  it('returns 404 for an unknown id', async () => {
    setupData(fallbackUsage())
    expect((await get('/api/timeline/nope')).statusCode).toBe(404)
  })
})
