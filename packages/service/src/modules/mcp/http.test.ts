import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { McpToken, RouterConfig, UserConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

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
import { mcpModule } from './index.js'
import { mcpHttpRoutes } from './http.js'
import { hashMcpToken } from './tokens.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

const ROUTER_CONFIG = {
  id: 'proj-1',
  name: 'Alpha',
  models: [{ modelId: 'openai/gpt-4o' }],
} as unknown as RouterConfig

const RAW_VIEWER = 'sk-rt-mcp-viewer-token'
const RAW_ADMIN = 'sk-rt-mcp-admin-token'
const RAW_EXPIRED = 'sk-rt-mcp-expired-token'

function mcpToken(id: string, raw: string, expiresAt?: string): McpToken {
  return {
    id,
    name: id,
    tokenHash: hashMcpToken(raw),
    tokenSnippet: raw.substring(0, 14),
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(expiresAt ? { expiresAt } : {}),
  }
}

// Two users on built-in roles: viewer holds read permissions only, admin holds
// every permission. Auth is resolved for real, through the users config.
const USERS = [
  {
    id: 'user-viewer',
    email: 'viewer@routerly.ai',
    passwordHash: 'x',
    roleId: 'viewer',
    routerIds: ['proj-1'],
    mcpTokens: [
      mcpToken('tok-viewer', RAW_VIEWER),
      mcpToken('tok-expired', RAW_EXPIRED, '2000-01-01T00:00:00.000Z'),
    ],
  },
  {
    id: 'user-admin',
    email: 'admin@routerly.ai',
    passwordHash: 'x',
    roleId: 'admin',
    routerIds: ['proj-1'],
    mcpTokens: [mcpToken('tok-admin', RAW_ADMIN)],
  },
] as unknown as UserConfig[]

/** Build a container with every service token present, then the full registry. */
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
  await app.register(mcpHttpRoutes)
  await app.ready()
  return app
}

/** Streamable HTTP requires both accept types and a JSON content type. */
const MCP_HEADERS = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
}

function rpc(method: string, params: unknown = {}) {
  return { jsonrpc: '2.0', id: 1, method, params }
}

async function post(token: string | null, body: object) {
  const app = await buildApp()
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { ...MCP_HEADERS, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: body,
  })
  await app.close()
  return res
}

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'routers') return [ROUTER_CONFIG] as never
    if (key === 'users') return USERS as never
    return [] as never
  })
})

describe('mcpHttpRoutes auth', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await post(null, rpc('tools/list'))
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unknown token (401)', async () => {
    const res = await post('sk-rt-mcp-nope', rpc('tools/list'))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).message).toContain('Invalid MCP token')
  })

  it('rejects a router token, which is not an MCP token (401)', async () => {
    const res = await post('sk-rt-plain-router-token', rpc('tools/list'))
    expect(res.statusCode).toBe(401)
  })

  it('rejects an expired token (401)', async () => {
    const res = await post(RAW_EXPIRED, rpc('tools/list'))
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).message).toContain('expired')
  })
})

describe('mcpHttpRoutes JSON-RPC', () => {
  it("lists only the tools the token owner's role permits (200)", async () => {
    const res = await post(RAW_VIEWER, rpc('tools/list'))
    expect(res.statusCode).toBe(200)
    const names = JSON.parse(res.body).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('list_models')
    expect(names).toContain('list_routers')
    // Viewer holds no router:write / token:write, so no write tool is listed.
    expect(names).not.toContain('create_router_token')
    expect(names).not.toContain('toggle_model')
  })

  it('lists the write tools for an admin token (200)', async () => {
    const res = await post(RAW_ADMIN, rpc('tools/list'))
    const names = JSON.parse(res.body).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('create_router_token')
    expect(names).toContain('toggle_model')
  })

  it('calls a read tool (list_models) (200)', async () => {
    const res = await post(RAW_VIEWER, rpc('tools/call', { name: 'list_models', arguments: {} }))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].type).toBe('text')
  })

  it('returns an isError body (not an HTTP error) for a tool the role cannot use', async () => {
    const res = await post(
      RAW_VIEWER,
      rpc('tools/call', { name: 'toggle_model', arguments: { modelId: 'openai/gpt-4o' } }),
    )
    // HTTP call succeeds; the permission failure surfaces inside the JSON-RPC result.
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('router:write')
    expect(mockWriteConfig).not.toHaveBeenCalledWith('routers', expect.anything())
  })
})
