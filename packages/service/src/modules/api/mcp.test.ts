import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Permission } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { ServiceContainer, type Token } from '../../core/index.js'
import {
  MCP_TOOLS,
  CATALOG,
  ROUTER,
  USAGE_TRACKER,
  BUDGET,
  OBSERVABILITY,
  CONFIG_STORE,
} from '../../core/tokens.js'
import { mcpModule } from '../mcp/index.js'
import { mcpApiRoutes } from './mcp.js'

// Mutable per-test dashUser the fake preHandler injects (mirrors the JWT preHandler
// that populates req.dashUser inside apiRoutes in production).
let currentPermissions: Permission[] | null = ['mcp:read']

/** Container with every backing service token present -> full tool registry. */
async function buildContainer(): Promise<ServiceContainer> {
  const rt = { container: new ServiceContainer(), events: { emit: () => {} } as never }
  await mcpModule.register(rt as never)
  const tokens: Token<unknown>[] = [CATALOG, ROUTER, USAGE_TRACKER, BUDGET, OBSERVABILITY, CONFIG_STORE]
  for (const t of tokens) rt.container.register(t, {} as never)
  await mcpModule.start?.(rt as never)
  return rt.container
}

async function buildApp(): Promise<FastifyInstance> {
  const container = await buildContainer()
  const app = Fastify({ logger: false })
  app.decorate('kernel', { container } as never)
  app.decorateRequest('dashUser', null)
  app.addHook('preHandler', async (req) => {
    req.dashUser = currentPermissions
      ? { id: 'u1', email: 'u@example.com', roleId: 'r', permissions: currentPermissions }
      : null
  })
  await app.register(mcpApiRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  currentPermissions = ['mcp:read']
})

describe('GET /api/mcp/tools', () => {
  it('returns the tool list for an mcp:read caller (200)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools' })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    const names = body.map((t: { name: string }) => t.name)
    expect(names).toContain('list_models')
    const entry = body.find((t: { name: string }) => t.name === 'list_models')
    expect(entry).toMatchObject({
      name: 'list_models',
      scope: 'read',
      enabled: true,
    })
    expect(typeof entry.description).toBe('string')
    expect(typeof entry.sourceModule).toBe('string')
    expect(entry.sourceModule.length).toBeGreaterThan(0)
  })

  it('filters by scope when ?scope=write is passed (200)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools?scope=write' })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.length).toBeGreaterThan(0)
    expect(body.every((t: { scope: string }) => t.scope === 'write')).toBe(true)
  })

  it('rejects a bad scope value (400)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools?scope=bogus' })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('forbids a caller without mcp:read (403)', async () => {
    currentPermissions = ['project:read']
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools' })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/mcp/tools/:name', () => {
  it('returns one tool for an mcp:read caller (200)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools/list_models' })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'list_models', scope: 'read', enabled: true })
  })

  it('returns 404 for an unknown tool name', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools/does_not_exist' })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('forbids a caller without mcp:read (403)', async () => {
    currentPermissions = ['project:read']
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/mcp/tools/list_models' })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})
