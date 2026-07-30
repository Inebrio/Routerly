// ─── MCP (Model Context Protocol) types ──────────────────────────────────────

import type { ProjectConfig, ProjectToken } from './config.js';

/** Auth context resolved from a project token for an MCP request. */
export interface McpAuthContext {
  project: ProjectConfig;
  token: ProjectToken;
  /** Resolved from ProjectToken.scopes (e.g. 'mcp', 'mcp:write'). */
  scopes: string[];
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
  /** 'read' tools are always listable; 'write' tools require the mcp:write scope. */
  scope: 'read' | 'write';
  handler(input: unknown, authCtx: McpAuthContext): Promise<McpToolResult>;
}
