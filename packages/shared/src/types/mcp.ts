// ─── MCP (Model Context Protocol) types ──────────────────────────────────────

import type { McpToken, Permission, RouterConfig } from './config.js';

/**
 * Auth context resolved from a user's MCP token.
 *
 * An MCP token belongs to a user, not to a router: every tool therefore runs
 * with that user's dashboard permissions and can only touch the routers the
 * user has access to.
 */
export interface McpAuthContext {
  user: { id: string; email: string; roleId: string };
  /** Permissions of the user's role, resolved at request time. */
  permissions: Permission[];
  /** Routers the token owner may act on. Never the full router list. */
  routers: RouterConfig[];
  token: McpToken;
}

/** Result returned by an MCP tool handler. Secret-free by contract. */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** A single MCP tool exposed to MCP-capable clients. */
export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema (zod-to-json-schema output) describing the tool input. */
  inputSchema: unknown;
  /** Descriptive only: 'write' tools mutate configuration. The gate is `permission`. */
  scope: 'read' | 'write';
  /** Dashboard permission the token owner must hold for this tool to be listed or callable. */
  permission: Permission;
  handler(input: unknown, authCtx: McpAuthContext): Promise<McpToolResult>;
}
