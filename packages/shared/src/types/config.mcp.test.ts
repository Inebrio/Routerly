import { describe, it, expect } from 'vitest';
import type { Permission, ProjectToken } from './config.js';

// Type-level: the two new MCP permissions are assignable to Permission.
const mcpRead: Permission = 'mcp:read';
const mcpManage: Permission = 'mcp:manage';

// Type-level + runtime: ProjectToken accepts a scopes array.
const token: ProjectToken = {
  id: 't1',
  token: 'sk-rt-secret',
  createdAt: '2026-07-28T00:00:00.000Z',
  scopes: ['mcp'],
};

describe('MCP permissions', () => {
  it('exposes mcp:read and mcp:manage as valid permissions', () => {
    const perms: Permission[] = [mcpRead, mcpManage];
    expect(perms).toEqual(['mcp:read', 'mcp:manage']);
  });
});

describe('ProjectToken.scopes', () => {
  it('accepts an mcp scope array', () => {
    expect(token.scopes).toEqual(['mcp']);
  });
});
