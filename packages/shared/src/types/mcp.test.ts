import { describe, it, expect } from 'vitest';
import type { McpTool, McpToolResult, McpAuthContext } from './mcp.js';
import type { McpToken, ProjectConfig } from './config.js';

const project: ProjectConfig = {
  id: 'p1',
  name: 'Test',
  tokens: [],
  members: [],
  models: [],
};

const token: McpToken = {
  id: 't1',
  name: 'laptop',
  tokenHash: 'a'.repeat(64),
  tokenSnippet: 'sk-rt-mcp-abc',
  createdAt: '2026-07-28T00:00:00.000Z',
};

const authCtx: McpAuthContext = {
  user: { id: 'u1', email: 'dev@routerly.ai', roleId: 'admin' },
  permissions: ['project:read', 'model:read'],
  projects: [project],
  token,
};

const okResult: McpToolResult = {
  content: [{ type: 'text', text: '{"models":[]}' }],
};

const errResult: McpToolResult = {
  content: [{ type: 'text', text: 'boom' }],
  isError: true,
};

const tool: McpTool = {
  name: 'list_models',
  description: 'List configured models',
  inputSchema: { type: 'object', properties: {} },
  scope: 'read',
  permission: 'model:read',
  async handler(_input, ctx) {
    return { content: [{ type: 'text', text: JSON.stringify(ctx.permissions) }] };
  },
};

describe('McpToolResult', () => {
  it('carries text content and optional isError flag', () => {
    expect(okResult.content[0]?.type).toBe('text');
    expect(okResult.content[0]?.text).toBe('{"models":[]}');
    expect(okResult.isError).toBeUndefined();
    expect(errResult.isError).toBe(true);
  });
});

describe('McpAuthContext', () => {
  it('binds the owning user, its permissions and its accessible projects', () => {
    expect(authCtx.user.id).toBe('u1');
    expect(authCtx.token.id).toBe('t1');
    expect(authCtx.permissions).toContain('project:read');
    expect(authCtx.projects.map(p => p.id)).toEqual(['p1']);
  });
});

describe('McpTool', () => {
  it('exposes name/description/inputSchema/scope/permission and an async handler', async () => {
    expect(tool.name).toBe('list_models');
    expect(tool.description).toBe('List configured models');
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(tool.scope).toBe('read');
    expect(tool.permission).toBe('model:read');

    const result = await tool.handler({}, authCtx);
    expect(result.content[0]?.text).toBe(JSON.stringify(['project:read', 'model:read']));
  });
});
