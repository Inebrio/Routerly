import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./stdio.js', () => ({ startStdioServer: vi.fn(async () => {}) }))
vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

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
import { readConfig, writeConfig } from '../config/loader.js'
import { mcpModule } from './index.js'
import { startStdioServer } from './stdio.js'
import { PRODUCT_VERSION } from '../../core/version.js'

const mockStartStdioServer = vi.mocked(startStdioServer)
const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

function runtime() {
  return { container: new ServiceContainer(), events: new EventBus() }
}

// The gate only reads container.has(token); the bound value is never used, so a
// minimal stub cast is enough to mark a token present.
function present(rt: ReturnType<typeof runtime>, ...tokens: Token<unknown>[]) {
  for (const t of tokens) rt.container.register(t, {} as never)
}

afterEach(() => {
  delete process.env['ROUTERLY_MCP_STDIO']
  mockStartStdioServer.mockClear()
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
})

describe('mcp module', () => {
  it('has the frozen manifest', () => {
    expect(mcpModule.manifest.id).toBe('mcp')
    expect(mcpModule.manifest.version).toBe(PRODUCT_VERSION)
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

  it('does not open the stdio transport when ROUTERLY_MCP_STDIO is unset', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    await mcpModule.start?.(rt)
    expect(mockStartStdioServer).not.toHaveBeenCalled()
  })

  it('opens the stdio transport when ROUTERLY_MCP_STDIO is 1', async () => {
    process.env['ROUTERLY_MCP_STDIO'] = '1'
    const rt = runtime()
    await mcpModule.register(rt)
    await mcpModule.start?.(rt)
    expect(mockStartStdioServer).toHaveBeenCalledOnce()
  })

  it('migrate() strips the retired mcp permissions from stored custom roles', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'custom', name: 'Custom', permissions: ['project:read', 'mcp:read', 'mcp:manage'] },
      { id: 'other', name: 'Other', permissions: ['report:read'] },
    ] as never)
    mockWriteConfig.mockResolvedValue(undefined as never)

    await mcpModule.migrate?.()

    expect(mockWriteConfig).toHaveBeenCalledOnce()
    const [key, written] = mockWriteConfig.mock.calls[0]!
    expect(key).toBe('roles')
    expect(written).toEqual([
      { id: 'custom', name: 'Custom', permissions: ['project:read'] },
      { id: 'other', name: 'Other', permissions: ['report:read'] },
    ])
  })

  it('migrate() writes nothing when no stored role carries them', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'custom', name: 'Custom', permissions: ['project:read'] },
    ] as never)

    await mcpModule.migrate?.()

    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})
