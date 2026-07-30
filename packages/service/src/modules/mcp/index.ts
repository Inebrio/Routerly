import { defineModule, type RouterlyModule } from '../../core/index.js'
import { MCP_TOOLS } from '../../core/tokens.js'
import { createMcpToolRegistry } from './registry.js'

/**
 * MCP module (Plan 6). register() binds an empty MCP_TOOLS registry into the
 * container. start() will contribute each built-in tool whose required DI token
 * is present and serve the stdio transport, but those land in later tasks; it is
 * a no-op stub for now so a container with no tool-producing tokens leaves the
 * registry empty.
 */
export const mcpModule: RouterlyModule = defineModule({
  manifest: { id: 'mcp', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(MCP_TOOLS, createMcpToolRegistry())
  },
  // ponytail: no built-in tools or stdio transport yet; wired in a later task.
  start() {},
})
