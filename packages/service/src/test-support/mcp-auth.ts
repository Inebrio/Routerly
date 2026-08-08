import type { McpAuthContext, McpToken, Permission, RouterConfig } from '@routerly/shared'

export const TEST_MCP_ROUTER = {
  id: 'proj-1',
  name: 'Alpha',
  models: [{ modelId: 'openai/gpt-4o' }],
} as RouterConfig

export const TEST_MCP_TOKEN: McpToken = {
  id: 'mcp-tok-1',
  name: 'laptop',
  tokenHash: 'a'.repeat(64),
  tokenSnippet: 'sk-rt-mcp-abc',
  createdAt: '2026-01-01T00:00:00.000Z',
}

/**
 * Build the auth context every MCP tool and transport handler receives. Defaults
 * to a single accessible router and the permissions of every built-in tool, so a
 * test only spells out what it is actually about (a narrower permission set, more
 * routers, none at all).
 */
export function mcpAuthContext(overrides: Partial<McpAuthContext> = {}): McpAuthContext {
  return {
    user: { id: 'user-1', email: 'dev@routerly.ai', roleId: 'admin' },
    permissions: [
      'model:read',
      'router:read',
      'router:write',
      'report:read',
      'token:write',
    ] as Permission[],
    routers: [TEST_MCP_ROUTER],
    token: TEST_MCP_TOKEN,
    ...overrides,
  }
}
