import { defineModule, type RouterlyModule } from '../../core/index.js'
import { MCP_TOOLS } from '../../core/tokens.js'
import { createMcpToolRegistry, type McpToolEntry } from './registry.js'
import {
  listModelsTool,
  getModelInstanceTool,
  routePreviewTool,
  usageSummaryTool,
  budgetStatusTool,
  metricsSnapshotTool,
  listProjectsTool,
} from './tools/read.js'

/** Built-in read tools, each carrying the DI token its backing module registers. */
const BUILT_IN_TOOLS: McpToolEntry[] = [
  listModelsTool,
  getModelInstanceTool,
  routePreviewTool,
  usageSummaryTool,
  budgetStatusTool,
  metricsSnapshotTool,
  listProjectsTool,
]

/**
 * MCP module (Plan 6). register() binds an empty MCP_TOOLS registry into the
 * container. start() contributes each built-in tool whose required DI token is
 * present, so a tool whose backing module is not bootstrapped stays ABSENT from
 * the registry (not a stub) and disappears when its module is disabled.
 */
export const mcpModule: RouterlyModule = defineModule({
  manifest: { id: 'mcp', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(MCP_TOOLS, createMcpToolRegistry())
  },
  start({ container }) {
    const registry = container.resolve(MCP_TOOLS)
    for (const tool of BUILT_IN_TOOLS) {
      // ponytail: DI-token presence IS the enable proxy; replace with Plan 0
      // isModuleEnabled when available.
      if (container.has(tool.requires)) {
        registry.contribute({ id: tool.name, value: tool })
      }
    }
  },
})
