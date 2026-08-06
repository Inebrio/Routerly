import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { McpToken, Permission, UserConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { readConfig, writeConfig } from '../config/loader.js'
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
import { hashMcpToken, MCP_TOKEN_PREFIX } from '../mcp/tokens.js'
import { mcpApiRoutes } from './mcp.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

// Mutable per-test dashUser the fake preHandler injects (mirrors the JWT preHandler
// that populates req.dashUser inside apiRoutes in production).
let currentPermissions: Permission[] = ['model:read', 'router:read']
let currentUserId = 'u1'

const EXISTING_TOKEN: McpToken = {
  id: 'tok-1',
  name: 'laptop',
  tokenHash: hashMcpToken('sk-rt-mcp-existing'),
  tokenSnippet: 'sk-rt-mcp-ex',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function users(): UserConfig[] {
  return [
    {
      id: 'u1',
      email: 'u@example.com',
      passwordHash: 'x',
      roleId: 'admin',
      routerIds: [],
      mcpTokens: [{ ...EXISTING_TOKEN }],
    },
  ] as unknown as UserConfig[]
}

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
    req.dashUser = {
      id: currentUserId,
      email: 'u@example.com',
      roleId: 'r',
      permissions: currentPermissions,
    }
  })
  await app.register(mcpApiRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  currentPermissions = ['model:read', 'router:read']
  currentUserId = 'u1'
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
  mockReadConfig.mockImplementation(async (key: string) =>
    (key === 'users' ? users() : []) as never,
  )
})

describe('GET /api/me/mcp-tools', () => {
  it("returns only the tools the caller's permissions cover (200)", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/me/mcp-tools' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const names = body.map((t: { name: string }) => t.name)
    expect(names).toContain('list_models')
    expect(names).toContain('list_routers')
    // No token:write / router:write held, so the write tools stay hidden.
    expect(names).not.toContain('create_router_token')
    expect(names).not.toContain('toggle_model')

    const entry = body.find((t: { name: string }) => t.name === 'list_models')
    expect(entry).toMatchObject({ name: 'list_models', scope: 'read', permission: 'model:read' })
    expect(typeof entry.description).toBe('string')
    expect(entry.sourceModule.length).toBeGreaterThan(0)
  })

  it('returns an empty list for a caller with no matching permission (200)', async () => {
    currentPermissions = ['audit:read']
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/me/mcp-tools' })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

describe('GET /api/me/mcp-tokens', () => {
  it("lists the caller's own tokens without the hash (200)", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/me/mcp-tokens' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toEqual({
      id: 'tok-1',
      name: 'laptop',
      tokenSnippet: 'sk-rt-mcp-ex',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(res.body).not.toContain(EXISTING_TOKEN.tokenHash)
  })

  it('returns 404 when the caller no longer exists', async () => {
    currentUserId = 'ghost'
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/me/mcp-tokens' })
    await app.close()

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/me/mcp-tokens', () => {
  it('mints a token, stores only its hash, and reveals the raw value once (201)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/mcp-tokens',
      payload: { name: 'desktop' },
    })
    await app.close()

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('desktop')
    expect(body.token.startsWith(MCP_TOKEN_PREFIX)).toBe(true)
    expect(body.tokenHash).toBeUndefined()

    const [key, written] = mockWriteConfig.mock.calls[0]!
    expect(key).toBe('users')
    const stored = (written as UserConfig[])[0]!.mcpTokens!
    expect(stored).toHaveLength(2)
    const minted = stored[1]!
    expect(minted.tokenHash).toBe(hashMcpToken(body.token))
    // The raw value is never persisted, only its hash.
    expect(JSON.stringify(written)).not.toContain(body.token)
  })

  it('accepts an expiry and stores it (201)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/mcp-tokens',
      payload: { name: 'ci', expiresAt: '2027-01-01T00:00:00.000Z' },
    })
    await app.close()

    expect(res.statusCode).toBe(201)
    expect(res.json().expiresAt).toBe('2027-01-01T00:00:00.000Z')
  })

  it('rejects a duplicate name, case-insensitively (409)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/mcp-tokens',
      payload: { name: 'LAPTOP' },
    })
    await app.close()

    expect(res.statusCode).toBe(409)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('rejects an empty name (400)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/me/mcp-tokens', payload: { name: '  ' } })
    await app.close()

    expect(res.statusCode).toBe(400)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/me/mcp-tokens/:id', () => {
  it('revokes the caller\'s token (204)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/me/mcp-tokens/tok-1' })
    await app.close()

    expect(res.statusCode).toBe(204)
    const written = mockWriteConfig.mock.calls[0]![1] as UserConfig[]
    expect(written[0]!.mcpTokens).toEqual([])
  })

  it('returns 404 for an unknown token id and writes nothing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/me/mcp-tokens/nope' })
    await app.close()

    expect(res.statusCode).toBe(404)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})
