import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { mockApi, mockSpawn, account } = vi.hoisted(() => ({
  mockApi: vi.fn(),
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

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: () => '/fake/@routerly/service/dist/index.js' }),
}));

import { makeMcpCommand } from './mcp.js';

const envToken = process.env['ROUTERLY_MCP_TOKEN'];

beforeEach(() => {
  // The CLI honours this env var; a developer shell that sets it must not
  // silently change what these tests exercise.
  delete process.env['ROUTERLY_MCP_TOKEN'];
});

afterEach(() => {
  vi.clearAllMocks();
  if (envToken === undefined) delete process.env['ROUTERLY_MCP_TOKEN'];
  else process.env['ROUTERLY_MCP_TOKEN'] = envToken;
});

function makeCmd() {
  const cmd = makeMcpCommand();
  cmd.exitOverride();
  return cmd;
}

const toolRows = [
  { name: 'list_models', description: 'List models', scope: 'read', sourceModule: 'catalog.service', permission: 'model:read' },
  { name: 'toggle_model', description: 'Toggle a model', scope: 'write', sourceModule: 'config.store', permission: 'project:write' },
];

const tokenRow = {
  id: 'tok-1',
  name: 'laptop',
  tokenSnippet: 'sk-rt-mcp-abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-02-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

/** Routes the mocked api() by method+path, as the CLI token flow makes 1-3 calls. */
function routeApi(existing: unknown[] = []) {
  mockApi.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/me/mcp-tokens') return existing;
    if (method === 'DELETE') return undefined;
    if (method === 'POST' && path === '/api/me/mcp-tokens') {
      return { ...tokenRow, id: 'tok-cli', name: 'routerly-cli', token: 'sk-rt-mcp-minted' };
    }
    throw new Error(`unexpected api call: ${method} ${path}`);
  });
}

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
  return lines;
}

// ─── mcp tools ───────────────────────────────────────────────────────────────

describe('mcp tools', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints the caller\'s tools with the permission that gates each one', async () => {
    mockApi.mockResolvedValueOnce(toolRows);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'tools']);
    const out = lines.join('\n');
    expect(out).toContain('list_models');
    expect(out).toContain('toggle_model');
    expect(out).toContain('model:read');
    expect(out).toContain('project:write');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/me/mcp-tools');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(toolRows);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'tools', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(toolRows);
  });

  it('shows an empty state when the role grants no tool', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'tools']);
    expect(lines.join('\n')).toContain('No MCP tool is available');
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
  });

  it('invalid --input fails before any network call', async () => {
    routeApi();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--input', '{bad json']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockApi).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('valid JSON'));
    vi.unstubAllGlobals();
  });

  it('mints the CLI token and POSTs a tools/call request, printing the result text', async () => {
    routeApi();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'gpt-4o\nclaude' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/me/mcp-tokens', { name: 'routerly-cli' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/mcp');
    expect(init.headers.Authorization).toBe('Bearer sk-rt-mcp-minted');
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_models', arguments: {} },
    });
    expect(lines.join('\n')).toContain('gpt-4o');
    vi.unstubAllGlobals();
  });

  it('rotates its own token: the previous routerly-cli token is revoked first', async () => {
    routeApi([{ ...tokenRow, id: 'tok-old', name: 'routerly-cli' }, tokenRow]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/me/mcp-tokens/tok-old');
    vi.unstubAllGlobals();
  });

  it('uses ROUTERLY_MCP_TOKEN without touching the token API', async () => {
    routeApi();
    process.env['ROUTERLY_MCP_TOKEN'] = 'sk-rt-mcp-from-env';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models']);
    expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe('Bearer sk-rt-mcp-from-env');
    expect(mockApi).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('uses an explicit --token instead of minting', async () => {
    routeApi();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--token', 'sk-rt-mcp-explicit']);
    expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe('Bearer sk-rt-mcp-explicit');
    expect(mockApi).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('passes parsed --input as the tool arguments', async () => {
    routeApi();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'get_model', '--input', '{"modelId":"x"}']);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body).params.arguments).toEqual({ modelId: 'x' });
    vi.unstubAllGlobals();
  });

  it('result.isError -> stderr + exit 1', async () => {
    routeApi();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { isError: true, content: [{ type: 'text', text: "requires the 'project:write' permission" }] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'test', 'toggle_model'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('project:write'));
    vi.unstubAllGlobals();
  });

  it('HTTP 401 (string error + message) surfaces the actionable message', async () => {
    routeApi();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized', message: 'MCP token expired.' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('MCP token expired'));
    vi.unstubAllGlobals();
  });

  it('JSON-RPC protocol error -> stderr + exit 1', async () => {
    routeApi();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: { code: -32601, message: 'Method not found' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'test', 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Method not found'));
    vi.unstubAllGlobals();
  });

  it('outputs the raw result with --json', async () => {
    routeApi();
    const result = { content: [{ type: 'text', text: 'ok' }] };
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ result }) });
    vi.stubGlobal('fetch', fetchSpy);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(result);
    vi.unstubAllGlobals();
  });

  it('exits 1 when the token cannot be minted', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValue(new ApiError(401, 'Session expired'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'test', 'list_models'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ─── mcp serve ───────────────────────────────────────────────────────────────

describe('mcp serve', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('spawns the service with stdio inherited and the minted MCP token in the env', async () => {
    routeApi();
    const child = { on: vi.fn((event: string, cb: () => void) => { if (event === 'exit') cb(); }) };
    mockSpawn.mockReturnValue(child);
    await makeCmd().parseAsync(['node', 'mcp', 'serve']);
    const [bin, args, options] = mockSpawn.mock.calls[0]!;
    expect(bin).toBe('node');
    expect(args).toEqual(['/fake/@routerly/service/dist/index.js']);
    expect(options.stdio).toBe('inherit');
    expect(options.env.ROUTERLY_MCP_STDIO).toBe('1');
    expect(options.env.ROUTERLY_MCP_TOKEN).toBe('sk-rt-mcp-minted');
  });

  it('passes an explicit --token through untouched', async () => {
    routeApi();
    const child = { on: vi.fn((event: string, cb: () => void) => { if (event === 'exit') cb(); }) };
    mockSpawn.mockReturnValue(child);
    await makeCmd().parseAsync(['node', 'mcp', 'serve', '--token', 'sk-rt-mcp-explicit']);
    expect(mockSpawn.mock.calls[0]![2].env.ROUTERLY_MCP_TOKEN).toBe('sk-rt-mcp-explicit');
    expect(mockApi).not.toHaveBeenCalled();
    // A desktop client spawns this with no CLI login of its own.
    const { requireAccount } = await import('../store.js');
    expect(vi.mocked(requireAccount)).not.toHaveBeenCalled();
  });

  it('propagates the child exit code so a failed start is not reported as success', async () => {
    routeApi();
    const child = { on: vi.fn((event: string, cb: (code?: number) => void) => { if (event === 'exit') cb(1); }) };
    mockSpawn.mockReturnValue(child);
    process.exitCode = undefined;
    await makeCmd().parseAsync(['node', 'mcp', 'serve']);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('exits 1 without spawning when the token cannot be minted', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValue(new ApiError(401, 'Session expired'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'serve'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

// ─── mcp token ───────────────────────────────────────────────────────────────

describe('mcp token list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints the caller\'s tokens without any raw value', async () => {
    mockApi.mockResolvedValueOnce([tokenRow]);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('laptop');
    expect(out).toContain('sk-rt-mcp-abc');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/me/mcp-tokens');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([tokenRow]);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'list', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual([tokenRow]);
  });

  it('points at the create command when there is no token', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'list']);
    expect(lines.join('\n')).toContain('routerly mcp token create');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(500, 'boom'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'token', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('mcp token create', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reveals the raw token once', async () => {
    mockApi.mockResolvedValueOnce({ ...tokenRow, token: 'sk-rt-mcp-raw' });
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'create', 'laptop']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/me/mcp-tokens', { name: 'laptop' });
    const out = lines.join('\n');
    expect(out).toContain('sk-rt-mcp-raw');
    expect(out).toContain('shown only once');
  });

  it('sends --expires as an ISO instant', async () => {
    mockApi.mockResolvedValueOnce({ ...tokenRow, token: 'sk-rt-mcp-raw' });
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'create', 'ci', '--expires', '2027-01-01']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/me/mcp-tokens', {
      name: 'ci',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
  });

  it('rejects an unparseable --expires before calling the API', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'mcp', 'token', 'create', 'ci', '--expires', 'someday']),
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('outputs raw JSON with --json', async () => {
    const created = { ...tokenRow, token: 'sk-rt-mcp-raw' };
    mockApi.mockResolvedValueOnce(created);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'create', 'laptop', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(created);
  });

  it('surfaces a duplicate name (409) and exits 1', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, 'An MCP token named "laptop" already exists'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'token', 'create', 'laptop'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });
});

describe('mcp token remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('revokes the token', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const lines = captureLog();
    await makeCmd().parseAsync(['node', 'mcp', 'token', 'remove', 'tok-1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/me/mcp-tokens/tok-1');
    expect(lines.join('\n')).toContain('revoked');
  });

  it('reports an unknown id and exits 1', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Token not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'mcp', 'token', 'remove', 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});
