import type { McpAuthContext, McpToken, Permission, ProjectConfig } from '@routerly/shared'

export const TEST_MCP_PROJECT = {
  id: 'proj-1',
  name: 'Alpha',
  models: [{ modelId: 'openai/gpt-4o' }],
} as ProjectConfig

export const TEST_MCP_TOKEN: McpToken = {
  id: 'mcp-tok-1',
  name: 'laptop',
  tokenHash: 'a'.repeat(64),
  tokenSnippet: 'sk-rt-mcp-abc',
  createdAt: '2026-01-01T00:00:00.000Z',
}

/**
 * Build the auth context every MCP tool and transport handler receives. Defaults
 * to a single accessible project and the permissions of every built-in tool, so a
 * test only spells out what it is actually about (a narrower permission set, more
 * projects, none at all).
 */
export function mcpAuthContext(overrides: Partial<McpAuthContext> = {}): McpAuthContext {
  return {
    user: { id: 'user-1', email: 'dev@routerly.ai', roleId: 'admin' },
    permissions: [
      'model:read',
      'project:read',
      'project:write',
      'report:read',
      'token:write',
    ] as Permission[],
    projects: [TEST_MCP_PROJECT],
    token: TEST_MCP_TOKEN,
    ...overrides,
  }
}
