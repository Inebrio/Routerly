import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

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

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

// One project, three tokens carrying different scope sets.
const PROJECT = {
  id: 'proj-1',
  name: 'Alpha',
  models: [{ modelId: 'openai/gpt-4o' }],
  tokens: [
    { id: 'tok-read', token: 'sk-read', scopes: ['mcp'] },
    { id: 'tok-write', token: 'sk-write', scopes: ['mcp', 'mcp:write'] },
    { id: 'tok-noscope', token: 'sk-noscope', scopes: [] },
  ],
} as unknown as ProjectConfig

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

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
  mockReadConfig.mockImplementation(async (key: string) =>
    (key === 'projects' ? [PROJECT] : []) as never,
  )
})

describe('mcpHttpRoutes auth', () => {
  it('rejects a request with no token (401)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: rpc('tools/list'),
    })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it('rejects a valid token lacking the mcp scope (403)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: 'Bearer sk-noscope' },
      payload: rpc('tools/list'),
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

describe('mcpHttpRoutes JSON-RPC', () => {
  it('lists tools for a token with the mcp scope (200)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: 'Bearer sk-read' },
      payload: rpc('tools/list'),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const names = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('list_models')
    expect(names).toContain('list_projects')
    // Read-only scope must not see write tools.
    expect(names).not.toContain('create_project_token')
  })

  it('calls a read tool (list_models) (200)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: 'Bearer sk-read' },
      payload: rpc('tools/call', { name: 'list_models', arguments: {} }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].type).toBe('text')
  })

  it('returns an isError body (not an HTTP error) for a write tool without mcp:write', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: 'Bearer sk-read' },
      payload: rpc('tools/call', {
        name: 'toggle_model',
        arguments: { modelId: 'openai/gpt-4o' },
      }),
    })
    await app.close()
    // HTTP call succeeds; the scope failure surfaces inside the JSON-RPC result.
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('mcp:write')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})
