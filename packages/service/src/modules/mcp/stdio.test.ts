import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpAuthContext } from '@routerly/shared'

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
import { mcpAuthContext } from '../../test-support/mcp-auth.js'
import { mcpModule } from './index.js'
import { startStdioServer } from './stdio.js'

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

/** A resolveAuth double returning a fixed context, like buildAuthContext would. */
function fakeResolveAuth(context: McpAuthContext) {
  return async () => ({ context })
}

beforeEach(() => {
  process.env['ROUTERLY_MCP_TOKEN'] = 'sk-rt-mcp-stdio-token'
})

afterEach(() => {
  delete process.env['ROUTERLY_MCP_TOKEN']
})

describe('startStdioServer', () => {
  it('lists tools and round-trips a tools/call over a linked transport pair', async () => {
    const { container, registry } = await fullRegistry()
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

    await startStdioServer(registry, container, fakeResolveAuth(mcpAuthContext()), serverSide)

    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientSide)

    const listed = await client.listTools()
    const names = listed.tools.map((t) => t.name)
    expect(names).toContain('list_routers')

    const called = await client.callTool({ name: 'list_routers', arguments: {} })
    const content = called.content as { type: string; text: string }[]
    expect(content[0]?.text).toContain('Alpha')

    await client.close()
  })

  it('exposes only the tools the token owner has permission for', async () => {
    const { container, registry } = await fullRegistry()
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

    await startStdioServer(
      registry,
      container,
      fakeResolveAuth(mcpAuthContext({ permissions: ['model:read'] })),
      serverSide,
    )

    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientSide)

    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(['list_models', 'get_model'])

    await client.close()
  })

  it('throws when ROUTERLY_MCP_TOKEN is unset', async () => {
    delete process.env['ROUTERLY_MCP_TOKEN']
    const { container, registry } = await fullRegistry()
    const [, serverSide] = InMemoryTransport.createLinkedPair()

    await expect(
      startStdioServer(registry, container, fakeResolveAuth(mcpAuthContext()), serverSide),
    ).rejects.toThrow(/ROUTERLY_MCP_TOKEN is required/)
  })

  it('throws with the resolver message when the token is rejected', async () => {
    const { container, registry } = await fullRegistry()
    const [, serverSide] = InMemoryTransport.createLinkedPair()

    await expect(
      startStdioServer(registry, container, async () => ({ error: 'MCP token expired.' }), serverSide),
    ).rejects.toThrow(/MCP token expired/)
  })
})
