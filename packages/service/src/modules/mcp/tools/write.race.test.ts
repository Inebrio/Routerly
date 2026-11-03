import { describe, it, expect } from 'vitest'
import type { RouterConfig } from '@routerly/shared'
import { initConfigDirs, readConfig, writeConfig } from '../../config/loader.js'
import { createRouterTokenTool, toggleModelTool } from './write.js'
import { mcpAuthContext } from '../../../test-support/mcp-auth.js'

// Real-filesystem proof (ROUT-364): concurrent write tools must not lose updates.
describe('MCP write tools - concurrent calls', () => {
  it('two concurrent toggle_model calls end back at the initial state', async () => {
    await initConfigDirs()
    const router = { id: 'r1', name: 'R', models: [{ modelId: 'openai/gpt-4o' }] } as RouterConfig
    await writeConfig('routers', [router])
    const ctx = mcpAuthContext({ routers: [router] })

    const results = await Promise.all([
      toggleModelTool.handler({ modelId: 'openai/gpt-4o' }, ctx),
      toggleModelTool.handler({ modelId: 'openai/gpt-4o' }, ctx),
    ])

    const flags = results.map((r) => JSON.parse(r.content[0]!.text).enabled).sort()
    expect(flags).toEqual([false, true])
    expect((await readConfig('routers'))[0]!.models[0]!.enabled).toBe(true)
  })

  it('two concurrent create_router_token calls keep both tokens', async () => {
    await initConfigDirs()
    const router = { id: 'r2', name: 'R2', models: [], tokens: [] } as unknown as RouterConfig
    await writeConfig('routers', [router])
    const ctx = mcpAuthContext({ routers: [router] })

    await Promise.all([
      createRouterTokenTool.handler({}, ctx),
      createRouterTokenTool.handler({}, ctx),
    ])

    expect((await readConfig('routers'))[0]!.tokens).toHaveLength(2)
  })
})
