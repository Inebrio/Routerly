import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ProjectConfig, ProjectToken } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
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
import { startStdioServer } from './stdio.js'

const PROJECT: ProjectConfig = {
  id: 'proj-1',
  name: 'Alpha',
  models: [{ modelId: 'openai/gpt-4o' }],
} as ProjectConfig

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

/** A resolveAuth double that returns a token with the given scopes/expiry. */
function fakeResolveAuth(token: ProjectToken) {
  return async () => ({ project: PROJECT, token })
}

beforeEach(() => {
  process.env['ROUTERLY_MCP_TOKEN'] = 'sk-rt-stdio-token'
})

afterEach(() => {
  delete process.env['ROUTERLY_MCP_TOKEN']
})

describe('startStdioServer', () => {
  it('lists tools and round-trips a tools/call over a linked transport pair', async () => {
    const { container, registry } = await fullRegistry()
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

    const token = { id: 'tok-1', token: 'sk-rt-stdio-token', scopes: ['mcp'] } as ProjectToken
    await startStdioServer(registry, container, fakeResolveAuth(token), serverSide)

    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientSide)

    const listed = await client.listTools()
    const names = listed.tools.map((t) => t.name)
    expect(names).toContain('list_projects')

    const called = await client.callTool({ name: 'list_projects', arguments: {} })
    const content = called.content as { type: string; text: string }[]
    expect(content[0]?.text).toContain('Alpha')

    await client.close()
  })

  it('throws when ROUTERLY_MCP_TOKEN is unset', async () => {
    delete process.env['ROUTERLY_MCP_TOKEN']
    const { container, registry } = await fullRegistry()
    const [, serverSide] = InMemoryTransport.createLinkedPair()
    const token = { id: 'tok-1', token: 'x', scopes: ['mcp'] } as ProjectToken
    await expect(
      startStdioServer(registry, container, fakeResolveAuth(token), serverSide),
    ).rejects.toThrow(/ROUTERLY_MCP_TOKEN is required/)
  })

  it('throws when the resolved token lacks the mcp scope', async () => {
    const { container, registry } = await fullRegistry()
    const [, serverSide] = InMemoryTransport.createLinkedPair()
    const token = { id: 'tok-1', token: 'sk-rt-stdio-token', scopes: [] } as unknown as ProjectToken
    await expect(
      startStdioServer(registry, container, fakeResolveAuth(token), serverSide),
    ).rejects.toThrow(/mcp/)
  })

  it('throws when the token is not found', async () => {
    const { container, registry } = await fullRegistry()
    const [, serverSide] = InMemoryTransport.createLinkedPair()
    await expect(
      startStdioServer(registry, container, async () => null, serverSide),
    ).rejects.toThrow(/Invalid ROUTERLY_MCP_TOKEN/)
  })

  it('throws when the token is expired', async () => {
    const { container, registry } = await fullRegistry()
    const [, serverSide] = InMemoryTransport.createLinkedPair()
    const token = {
      id: 'tok-1',
      token: 'sk-rt-stdio-token',
      scopes: ['mcp'],
      expiresAt: '2000-01-01T00:00:00.000Z',
    } as ProjectToken
    await expect(
      startStdioServer(registry, container, fakeResolveAuth(token), serverSide),
    ).rejects.toThrow(/expired/)
  })
})
