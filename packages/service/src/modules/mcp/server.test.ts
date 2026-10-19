import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpAuthContext, Permission } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

import { readConfig, writeConfig } from '../config/loader.js'
import { logAudit } from '../audit/logger.js'
import { ServiceContainer, EventBus, type Token } from '../../core/index.js'
import {
  MCP_TOOLS,
  CATALOG,
  ROUTER,
  USAGE_TRACKER,
  BUDGET,
  OBSERVABILITY,
  CONFIG_STORE,
} from '../../core/tokens.js'
import { mcpAuthContext } from '../../test-support/mcp-auth.js'
import { mcpModule } from './index.js'
import { buildMcpServer } from './server.js'

vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn() }))
const mockLogAudit = vi.mocked(logAudit)
const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

/** Populate a container with every service token, then build the full registry. */
async function fullRegistry() {
  const rt = { container: new ServiceContainer(), events: new EventBus() }
  await mcpModule.register(rt)
  const tokens: Token<unknown>[] = [CATALOG, ROUTER, USAGE_TRACKER, BUDGET, OBSERVABILITY, CONFIG_STORE]
  for (const t of tokens) {
    rt.container.register(t, {} as never)
  }
  await mcpModule.start?.(rt)
  return { container: rt.container, registry: rt.container.resolve(MCP_TOOLS) }
}

/** Minimal in-memory transport implementing the SDK's Transport shape. */
function makeFakeTransport() {
  const sent: any[] = []
  const transport: any = {
    async start() {},
    async send(message: any) {
      sent.push(message)
    },
    async close() {},
  }
  return { transport, sent }
}

function authInfo(context: McpAuthContext) {
  return {
    token: 'sk-rt-mcp-secret',
    clientId: context.user.id,
    scopes: context.permissions,
    extra: { mcpContext: context },
  }
}

/** Response delivery is async across several microtask hops; poll for it. */
async function waitForSend(sent: any[], timeoutMs = 1000) {
  const start = Date.now()
  while (sent.length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for response')
    await new Promise((r) => setTimeout(r, 0))
  }
  return sent[sent.length - 1]
}

async function request(permissions: Permission[], method: string, params: unknown = {}) {
  const { container, registry } = await fullRegistry()
  const server = buildMcpServer(registry, container)
  const { transport, sent } = makeFakeTransport()
  await server.connect(transport)
  transport.onmessage(
    { jsonrpc: '2.0', id: 1, method, params },
    { authInfo: authInfo(mcpAuthContext({ permissions })) },
  )
  return waitForSend(sent)
}

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockLogAudit.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
})

describe('buildMcpServer tools/list', () => {
  it('hides tools whose permission the token owner lacks', async () => {
    const res = await request(['router:read'], 'tools/list')
    const names = res.result.tools.map((t: any) => t.name)
    expect(names).toContain('list_routers')
    expect(names).not.toContain('create_router_token')
    expect(names).not.toContain('toggle_model')
    expect(names).not.toContain('list_models')
  })

  it('exposes the write tools once their permissions are held', async () => {
    const res = await request(['token:write', 'router:write'], 'tools/list')
    const names = res.result.tools.map((t: any) => t.name)
    expect(names).toContain('create_router_token')
    expect(names).toContain('toggle_model')
  })

  it('lists nothing for a token owner with no matching permission', async () => {
    const res = await request(['audit:read'], 'tools/list')
    expect(res.result.tools).toEqual([])
  })
})

describe('buildMcpServer tools/call', () => {
  it('rejects a tool the caller has no permission for and performs no write', async () => {
    const res = await request(['router:read'], 'tools/call', {
      name: 'toggle_model',
      arguments: { modelId: 'openai/gpt-4o' },
    })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toContain('router:write')
    expect(mockWriteConfig).not.toHaveBeenCalled()
    expect(mockReadConfig).not.toHaveBeenCalled()
  })

  it('returns an isError result for an unknown tool, not a thrown rejection', async () => {
    const res = await request(['router:read'], 'tools/call', { name: 'no_such_tool', arguments: {} })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toContain('no_such_tool')
  })

  it('round-trips a read tool through the transport', async () => {
    const res = await request(['router:read'], 'tools/call', { name: 'list_routers', arguments: {} })
    expect(res.result.isError).toBeUndefined()
    expect(res.result.content[0].type).toBe('text')
    expect(res.result.content[0].text).toContain('Alpha')
  })

  it('returns a JSON-RPC error (not a result) when the auth context is missing', async () => {
    const { container, registry } = await fullRegistry()
    const server = buildMcpServer(registry, container)
    const { transport, sent } = makeFakeTransport()
    await server.connect(transport)
    // No authInfo on the second argument: toAuthContext must throw an McpError,
    // which the SDK turns into a JSON-RPC error response, not a transport crash.
    transport.onmessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {})
    const res = await waitForSend(sent)
    expect(res.error).toBeDefined()
    expect(res.result).toBeUndefined()
    expect(res.error.message).toContain('Missing MCP auth context')
  })
})

describe('buildMcpServer write-tool audit', () => {
  const router = { id: 'proj-1', name: 'Alpha', models: [{ modelId: 'openai/gpt-4o' }] }

  it('audits a successful create_router_token with ids and no raw token', async () => {
    mockReadConfig.mockResolvedValue([{ ...router }] as never)
    const res = await request(['token:write'], 'tools/call', { name: 'create_router_token', arguments: {} })
    expect(res.result.isError).toBeUndefined()
    const entry = mockLogAudit.mock.calls[0]![0]
    expect(entry).toMatchObject({ userId: 'user-1', email: 'dev@routerly.ai', action: 'mcp:create_router_token', result: 'success' })
    expect((entry.details as any).result.id).toBeTruthy()
    expect(JSON.stringify(entry)).not.toContain('sk-rt-' + '0'.repeat(1))
    expect(JSON.stringify(entry)).not.toMatch(/"token":/)
  })

  it('audits a successful toggle_model with routerId, modelId and new state', async () => {
    mockReadConfig.mockResolvedValue([{ ...router, models: [{ modelId: 'openai/gpt-4o' }] }] as never)
    await request(['router:write'], 'tools/call', {
      name: 'toggle_model',
      arguments: { routerId: 'proj-1', modelId: 'openai/gpt-4o' },
    })
    expect(mockLogAudit.mock.calls[0]![0]).toMatchObject({
      action: 'mcp:toggle_model',
      result: 'success',
      details: { routerId: 'proj-1', modelId: 'openai/gpt-4o', result: { modelId: 'openai/gpt-4o', enabled: false } },
    })
  })

  it('audits a permission refusal on a write tool as forbidden', async () => {
    await request(['router:read'], 'tools/call', { name: 'toggle_model', arguments: { modelId: 'x' } })
    expect(mockLogAudit.mock.calls[0]![0]).toMatchObject({ action: 'mcp:toggle_model', result: 'forbidden' })
  })

  it('does not audit read tools', async () => {
    await request(['router:read'], 'tools/call', { name: 'list_routers', arguments: {} })
    expect(mockLogAudit).not.toHaveBeenCalled()
  })
})
