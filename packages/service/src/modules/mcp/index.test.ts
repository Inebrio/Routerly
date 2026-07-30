import { describe, it, expect } from 'vitest'
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

function runtime() {
  return { container: new ServiceContainer(), events: new EventBus() }
}

// The gate only reads container.has(token); the bound value is never used, so a
// minimal stub cast is enough to mark a token present.
function present(rt: ReturnType<typeof runtime>, ...tokens: Token<unknown>[]) {
  for (const t of tokens) rt.container.register(t, {} as never)
}

describe('mcp module', () => {
  it('has the frozen manifest', () => {
    expect(mcpModule.manifest.id).toBe('mcp')
    expect(mcpModule.manifest.version).toBe('0.4.0')
  })

  it('register() binds an empty MCP_TOOLS registry into the container', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    const registry = rt.container.resolve(MCP_TOOLS)
    expect(registry.ordered()).toEqual([])
  })

  it('start() on a container with no service tokens contributes no built-in tools', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    await mcpModule.start?.(rt)
    expect(rt.container.resolve(MCP_TOOLS).ordered()).toEqual([])
  })

  it('start() contributes only tools whose required token is present', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    // CATALOG present but OBSERVABILITY absent.
    present(rt, CATALOG)
    await mcpModule.start?.(rt)

    const registry = rt.container.resolve(MCP_TOOLS)
    expect(registry.get('list_models')).toBeDefined()
    expect(registry.get('get_model')).toBeDefined()
    expect(registry.get('get_metrics_snapshot')).toBeUndefined()
    expect(registry.get('route_preview')).toBeUndefined()
  })

  it('start() contributes every built-in tool when all required tokens are present', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    present(rt, CATALOG, ROUTER, USAGE_TRACKER, BUDGET, OBSERVABILITY, CONFIG_STORE)
    await mcpModule.start?.(rt)

    const registry = rt.container.resolve(MCP_TOOLS)
    const names = registry.ordered().map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'list_models',
        'get_model',
        'route_preview',
        'get_usage_summary',
        'get_budget_status',
        'get_metrics_snapshot',
        'list_projects',
        'create_project_token',
        'toggle_model',
      ].sort(),
    )
  })
})
