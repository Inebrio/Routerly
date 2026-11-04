import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn(), updateConfig: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }))
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw'),
}))
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
vi.mock('../trace/store.js', () => ({ getTrace: vi.fn() }))
vi.mock('../update-checker/update-checker.js', () => ({
  updateChecker: { getLastResult: vi.fn(() => null), check: vi.fn(), getAvailableReleases: vi.fn(() => []), updateChannel: vi.fn() },
}))
vi.mock('../telemetry/telemetry.js', () => ({ pingTelemetry: vi.fn() }))
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }))

import { apiRoutes } from './api.js'
import { readConfig, updateConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockUpdateConfig = vi.mocked(updateConfig as any)
const mockVerifyToken = vi.mocked(verifyToken)
afterEach(() => vi.clearAllMocks())

const routers = [
  { id: 'support', name: 'support', tokens: [] },
  { id: 'research', name: 'research', tokens: [] },
]
const usage = [
  { id: 'u1', routerId: 'support', timestamp: new Date().toISOString(), inputTokens: 1, outputTokens: 1, cost: 1 },
  { id: 'u2', routerId: 'research', timestamp: new Date().toISOString(), inputTokens: 1, outputTokens: 1, cost: 1 },
]
const roles = [{ id: 'lead', name: 'lead', permissions: ['router:read', 'report:read', 'token:write'] }]

async function app(user: any) {
  mockVerifyToken.mockReturnValue({ sub: user.id } as any)
  mockReadConfig.mockImplementation(async (t: string) =>
    t === 'users' ? [user] : t === 'roles' ? roles : t === 'routers' ? routers : t === 'usage' ? usage : [])
  mockUpdateConfig.mockResolvedValue(undefined)
  const a = Fastify({ logger: false })
  await a.register(apiRoutes)
  await a.ready()
  return a
}
const h = { authorization: 'Bearer x' }
const carol = { id: 'carol', email: 'c@x', roleId: 'lead', routerIds: ['support'] }
const unscoped = { id: 'bob', email: 'b@x', roleId: 'lead', routerIds: [] }

describe('router assignment scoping (ROUT-596)', () => {
  it('lists only assigned routers', async () => {
    const r = await (await app(carol)).inject({ method: 'GET', url: '/api/routers', headers: h })
    expect(r.json().map((p: any) => p.id)).toEqual(['support'])
  })
  it('403 on token create for a non-assigned router', async () => {
    const r = await (await app(carol)).inject({ method: 'POST', url: '/api/routers/research/tokens', headers: h, payload: {} })
    expect(r.statusCode).toBe(403)
  })
  it('allows token create on an assigned router', async () => {
    const r = await (await app(carol)).inject({ method: 'POST', url: '/api/routers/support/tokens', headers: h, payload: {} })
    expect(r.statusCode).toBe(200)
  })
  it('usage report hides non-assigned routers', async () => {
    const r = await (await app(carol)).inject({ method: 'GET', url: '/api/usage?routerId=research', headers: h })
    expect(r.statusCode).toBe(200)
    expect(JSON.stringify(r.json())).not.toContain('"u2"')
    expect(r.json().records ?? []).toHaveLength(0)
  })
  it('unscoped user sees everything', async () => {
    const a = await app(unscoped)
    expect((await a.inject({ method: 'GET', url: '/api/routers', headers: h })).json()).toHaveLength(2)
    expect((await a.inject({ method: 'POST', url: '/api/routers/research/tokens', headers: h, payload: {} })).statusCode).toBe(200)
  })
})
