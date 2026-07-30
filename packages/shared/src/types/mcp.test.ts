import { describe, it, expect } from 'vitest';
import type { McpTool, McpToolResult, McpAuthContext } from './mcp.js';
import type { ProjectConfig, ProjectToken } from './config.js';

const project: ProjectConfig = {
  id: 'p1',
  name: 'Test',
  tokens: [],
  members: [],
  models: [],
};

const token: ProjectToken = {
  id: 't1',
  token: 'sk-rt-secret',
  createdAt: '2026-07-28T00:00:00.000Z',
  scopes: ['mcp'],
};

const authCtx: McpAuthContext = { project, token, scopes: ['mcp'] };

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
  async handler(_input, ctx) {
    return { content: [{ type: 'text', text: JSON.stringify(ctx.scopes) }] };
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
  it('binds project, token and resolved scopes', () => {
    expect(authCtx.project.id).toBe('p1');
    expect(authCtx.token.id).toBe('t1');
    expect(authCtx.scopes).toContain('mcp');
  });
});

describe('McpTool', () => {
  it('exposes name/description/inputSchema/scope and an async handler', async () => {
    expect(tool.name).toBe('list_models');
    expect(tool.description).toBe('List configured models');
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(tool.scope).toBe('read');

    const result = await tool.handler({}, authCtx);
    expect(result.content[0]?.text).toBe(JSON.stringify(['mcp']));
  });
});
