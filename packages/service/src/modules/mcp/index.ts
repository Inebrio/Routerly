import { defineModule, type RouterlyModule } from '../../core/index.js'
import { MCP_TOOLS } from '../../core/tokens.js'
import { readConfig, writeConfig } from '../config/loader.js'
import { createMcpToolRegistry, type McpToolEntry } from './registry.js'
import { startStdioServer } from './stdio.js'
import {
  listModelsTool,
  getModelInstanceTool,
  routePreviewTool,
  usageSummaryTool,
  budgetStatusTool,
  metricsSnapshotTool,
  listRoutersTool,
} from './tools/read.js'
import { createRouterTokenTool, toggleModelTool } from './tools/write.js'

/** Built-in tools, each carrying the DI token its backing module registers. */
const BUILT_IN_TOOLS: McpToolEntry[] = [
  listModelsTool,
  getModelInstanceTool,
  routePreviewTool,
  usageSummaryTool,
  budgetStatusTool,
  metricsSnapshotTool,
  listRoutersTool,
  createRouterTokenTool,
  toggleModelTool,
]

/**
 * MCP module (Plan 6). register() binds an empty MCP_TOOLS registry into the
 * container. start() contributes each built-in tool whose required DI token is
 * present, so a tool whose backing module is not bootstrapped stays ABSENT from
 * the registry (not a stub) and disappears when its module is disabled.
 */
export const mcpModule: RouterlyModule = defineModule({
  manifest: { id: 'mcp', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  /**
   * MCP used to be gated by two gateway-wide permissions. It is now personal (a
   * token grants exactly its owner's permissions), so those permissions no longer
   * exist in the union and would sit as dead strings inside stored custom roles.
   * Strip them once, on boot. Built-in roles are code, so they need no migration.
   */
  async migrate() {
    const roles = await readConfig('roles')
    const dead = new Set(['mcp:read', 'mcp:manage'])
    let changed = false
    const cleaned = roles.map((role) => {
      const permissions = role.permissions.filter((p) => !dead.has(p))
      if (permissions.length === role.permissions.length) return role
      changed = true
      return { ...role, permissions }
    })
    if (changed) await writeConfig('roles', cleaned)
  },
  register({ container }) {
    container.register(MCP_TOOLS, createMcpToolRegistry())
  },
  async start({ container }) {
    const registry = container.resolve(MCP_TOOLS)
    for (const tool of BUILT_IN_TOOLS) {
      // ponytail: DI-token presence IS the enable proxy; replace with Plan 0
      // isModuleEnabled when available.
      if (container.has(tool.requires)) {
        registry.contribute({ id: tool.name, value: tool })
      }
    }

    // Opt-in local stdio transport. Off by default so normal HTTP boot never
    // attaches stdin listeners. connect() resolves once the transport starts,
    // not when the session ends, so this await does not block boot.
    if (process.env['ROUTERLY_MCP_STDIO'] === '1') {
      await startStdioServer(registry, container)
    }
  },
})
