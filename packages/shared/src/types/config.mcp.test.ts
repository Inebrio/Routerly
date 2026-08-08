import { describe, it, expect } from 'vitest';
import type { McpToken, UserConfig } from './config.js';

const mcpToken: McpToken = {
  id: 't1',
  name: 'laptop',
  tokenHash: 'b'.repeat(64),
  tokenSnippet: 'sk-rt-mcp-abc',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const user: UserConfig = {
  id: 'u1',
  email: 'dev@routerly.ai',
  passwordHash: '$2b$12$hash',
  roleId: 'admin',
  routerIds: [],
  mcpTokens: [mcpToken],
};

describe('McpToken', () => {
  it('stores a hash and a snippet, never the raw token', () => {
    expect(Object.keys(mcpToken)).not.toContain('token');
    expect(mcpToken.tokenHash).toHaveLength(64);
    expect(mcpToken.tokenSnippet.startsWith('sk-rt-mcp-')).toBe(true);
  });
});

describe('UserConfig.mcpTokens', () => {
  it('holds the user-owned MCP tokens', () => {
    expect(user.mcpTokens).toHaveLength(1);
    expect(user.mcpTokens?.[0]?.name).toBe('laptop');
  });
});
