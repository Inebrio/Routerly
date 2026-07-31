import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { mockApi, mockAcquireToken, mockSpawn, account } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockAcquireToken: vi.fn(),
  mockSpawn: vi.fn(),
  account: {
    alias: 'test',
    serverUrl: 'http://localhost:3000',
    email: 'admin@example.com',
    token: 'jwt-test',
    expiresAt: Date.now() + 3_600_000,
  },
}));

vi.mock('../api.js', () => ({
  api: mockApi,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

vi.mock('../store.js', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue(account),
  requireAccount: vi.fn().mockResolvedValue(account),
}));

vi.mock('../clients/index.js', () => ({
  acquireToken: mockAcquireToken,
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: () => '/fake/@routerly/service/dist/index.js' }),
}));

import { makeMcpCommand } from './mcp.js';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeMcpCommand();
  cmd.exitOverride();
  return cmd;
}

const toolRows = [
  { name: 'list_models', description: 'List models', scope: 'read', sourceModule: 'catalog.service', enabled: true },
  { name: 'toggle_model', description: 'Toggle a model', scope: 'write', sourceModule: 'config.store', enabled: true },
];

const project = { id: 'proj-1', name: 'my-api', models: [], tokens: [], members: [], policies: [] };

// ─── mcp tools ───────────────────────────────────────────────────────────────

describe('mcp tools', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints tool rows in a table', async () => {
    mockApi.mockResolvedValueOnce(toolRows);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'mcp', 'tools']);
    const out = lines.join('\n');
    expect(out).toContain('list_models');
    expect(out).toContain('toggle_model');
    expect(out).toContain('read');
    expect(out).toContain('write');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/mcp/tools');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(toolRows);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'mcp', 'tools', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(toolRows);
  });

  it('shows empty state when no tools', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'mcp', 'tools']);
    expect(lines.join('\n')).toContain('No MCP tools found');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'tools'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });
});

// ─── mcp test ────────────────────────────────────────────────────────────────

describe('mcp test', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAcquireToken.mockResolvedValue('sk-rt-minted');
  });

  it('invalid --input fails before any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--input', '{bad json']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockAcquireToken).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('valid JSON'));
    vi.unstubAllGlobals();
  });

  it('mints a token and POSTs a tools/call JSON-RPC request, printing the result text', async () => {
    mockApi.mockResolvedValueOnce([project]); // resolveProject
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'gpt-4o\nclaude' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--project', 'my-api']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/mcp');
    expect(init.headers.Authorization).toBe('Bearer sk-rt-minted');
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_models', arguments: {} },
    });
    expect(lines.join('\n')).toContain('gpt-4o');
    vi.unstubAllGlobals();
  });

  it('passes parsed --input as the tool arguments', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'get_model', '--project', 'my-api', '--input', '{"modelId":"x"}']);
    const init = fetchSpy.mock.calls[0]![1];
    expect(JSON.parse(init.body).params.arguments).toEqual({ modelId: 'x' });
    vi.unstubAllGlobals();
  });

  it('uses an explicit --token instead of minting', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--project', 'my-api', '--token', 'sk-rt-explicit']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1', explicitToken: 'sk-rt-explicit' });
    vi.unstubAllGlobals();
  });

  it('result.isError -> stderr + exit 1', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ result: { isError: true, content: [{ type: 'text', text: 'requires mcp:write' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'test', 'toggle_model', '--project', 'my-api']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('mcp:write'));
    vi.unstubAllGlobals();
  });

  it('JSON-RPC protocol error -> stderr + exit 1', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ error: { code: -32601, message: 'Method not found' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'test', 'nope', '--project', 'my-api']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Method not found'));
    vi.unstubAllGlobals();
  });

  it('outputs the raw result with --json', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const result = { content: [{ type: 'text', text: 'ok' }] };
    const fetchSpy = vi.fn().mockResolvedValue({ json: async () => ({ result }) });
    vi.stubGlobal('fetch', fetchSpy);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--project', 'my-api', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(result);
    vi.unstubAllGlobals();
  });

  it('exits 1 when the project is not found', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--project', 'no-such']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

// ─── mcp serve ───────────────────────────────────────────────────────────────

describe('mcp serve', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAcquireToken.mockResolvedValue('sk-rt-minted');
  });

  it('spawns the service with stdio inherited and MCP stdio env set', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const child = { on: vi.fn((event: string, cb: () => void) => { if (event === 'exit') cb(); }) };
    mockSpawn.mockReturnValue(child);
    await makeCmd().parseAsync(['node', 'mcp', 'serve', '--project', 'my-api']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1' });
    const [bin, args, options] = mockSpawn.mock.calls[0]!;
    expect(bin).toBe('node');
    expect(args).toEqual(['/fake/@routerly/service/dist/index.js']);
    expect(options.stdio).toBe('inherit');
    expect(options.env.ROUTERLY_MCP_STDIO).toBe('1');
    expect(options.env.ROUTERLY_MCP_TOKEN).toBe('sk-rt-minted');
  });

  it('exits 1 when the project is not found', async () => {
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'serve', '--project', 'no-such']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
