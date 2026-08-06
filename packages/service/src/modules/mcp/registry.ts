import { AlterableRegistry, type Token } from '../../core/index.js'
import type { McpTool } from '@routerly/shared'

/**
 * A built-in MCP tool plus the DI token it depends on. The public `McpTool`
 * (shared) stays transport-facing; this internal entry adds the composition
 * gate: mcpModule.start (from a later task) contributes an entry only when
 * `container.has(requires)` is true, so a tool whose backing module is not
 * bootstrapped is ABSENT from the registry, not a stub.
 * // ponytail: DI-token presence IS the enable proxy; replace with Plan 0
 * // isModuleEnabled when available.
 */
export interface McpToolEntry extends McpTool {
  requires: Token<unknown>
}

export type McpToolRegistry = AlterableRegistry<McpToolEntry>

/** Thin factory: the MCP tool registry is a plain AlterableRegistry of entries. */
export function createMcpToolRegistry(): McpToolRegistry {
  return new AlterableRegistry<McpToolEntry>()
}
