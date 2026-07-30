import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectConfig, ProjectToken } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

import { readConfig, writeConfig } from '../config/loader.js'
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
import { mcpModule } from './index.js'
import { buildMcpServer } from './server.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

const PROJECT: ProjectConfig = {
  id: 'proj-1',
  name: 'Alpha',
  models: [{ modelId: 'openai/gpt-4o' }],
} as ProjectConfig

const TOKEN = { id: 'tok-1', token: 'sk-rt-secret' } as unknown as ProjectToken

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

function authInfo(scopes: string[]) {
  return {
    token: TOKEN.token,
    clientId: PROJECT.id,
    scopes,
    extra: { project: PROJECT, projectToken: TOKEN },
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

async function request(scopes: string[], method: string, params: unknown = {}) {
  const { container, registry } = await fullRegistry()
  const server = buildMcpServer(registry, container)
  const { transport, sent } = makeFakeTransport()
  await server.connect(transport)
  transport.onmessage(
    { jsonrpc: '2.0', id: 1, method, params },
    { authInfo: authInfo(scopes) },
  )
  return waitForSend(sent)
}

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
})

describe('buildMcpServer tools/list', () => {
  it('hides write tools for a read-only scope', async () => {
    const res = await request(['mcp'], 'tools/list')
    const names = res.result.tools.map((t: any) => t.name)
    expect(names).toContain('list_projects')
    expect(names).not.toContain('create_project_token')
    expect(names).not.toContain('toggle_model')
  })

  it('exposes write tools when mcp:write is present', async () => {
    const res = await request(['mcp', 'mcp:write'], 'tools/list')
    const names = res.result.tools.map((t: any) => t.name)
    expect(names).toContain('create_project_token')
    expect(names).toContain('toggle_model')
  })
})

describe('buildMcpServer tools/call', () => {
  it('rejects a write tool without mcp:write and performs no write', async () => {
    const res = await request(['mcp'], 'tools/call', {
      name: 'toggle_model',
      arguments: { modelId: 'openai/gpt-4o' },
    })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toContain('mcp:write')
    expect(mockWriteConfig).not.toHaveBeenCalled()
    expect(mockReadConfig).not.toHaveBeenCalled()
  })

  it('returns an isError result for an unknown tool, not a thrown rejection', async () => {
    const res = await request(['mcp'], 'tools/call', { name: 'no_such_tool', arguments: {} })
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toContain('no_such_tool')
  })

  it('round-trips a read tool through the transport', async () => {
    const res = await request(['mcp'], 'tools/call', { name: 'list_projects', arguments: {} })
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
