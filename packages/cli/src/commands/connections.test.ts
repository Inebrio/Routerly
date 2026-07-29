import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeConnectionsCommand } from './connections.js';

vi.mock('../api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

import { api, ApiError } from '../api.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

// ── list ──────────────────────────────────────────────────────────────────────

describe('connections list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('lists connections as json', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'c1', providerId: 'openai', label: 'Main', enabled: true }]);
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list', '--json']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/connections');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"c1"'));
  });

  it('prints table with connections (no --json)', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'c1', providerId: 'openai', label: 'Main', endpoint: 'https://api.openai.com/v1', enabled: true },
      { id: 'c2', providerId: 'ollama', label: 'Local', enabled: false },
    ]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('c1');
    expect(out).toContain('openai');
    expect(out).toContain('c2');
    expect(out).toContain('ollama');
  });

  it('prints message when no connections', async () => {
    mockApi.mockResolvedValueOnce([]);
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No connections configured'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('Network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });
});

// ── add ───────────────────────────────────────────────────────────────────────

describe('connections add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('adds a connection with --api-key, defaults enabled true', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c1', providerId: 'openai', label: 'Main', credentials: undefined, enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--provider-id', 'openai', '--label', 'Main', '--api-key', 'sk-abc']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/connections', {
      providerId: 'openai',
      label: 'Main',
      credentials: { apiKey: 'sk-abc' },
      enabled: true,
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('c1'));
  });

  it('adds a connection with --endpoint', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c2', providerId: 'ollama', label: 'Local', credentials: undefined, endpoint: 'http://localhost:11434/v1', enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--provider-id', 'ollama', '--label', 'Local', '--endpoint', 'http://localhost:11434/v1']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/connections', {
      providerId: 'ollama',
      label: 'Local',
      credentials: {},
      endpoint: 'http://localhost:11434/v1',
      enabled: true,
    });
  });

  it('--no-enabled adds a disabled connection', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c3', providerId: 'openai', label: 'Disabled one', credentials: undefined, enabled: false });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--provider-id', 'openai', '--label', 'Disabled one', '--no-enabled']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/connections', expect.objectContaining({ enabled: false }));
  });

  it('--credentials-json merges/overrides credentials', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c4', providerId: 'anthropic', label: 'Anthropic', credentials: undefined, enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--provider-id', 'anthropic', '--label', 'Anthropic',
      '--api-key', 'sk-old', '--credentials-json', '{"apiKey":"sk-new","extra":"x"}',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/connections', expect.objectContaining({
      credentials: { apiKey: 'sk-new', extra: 'x' },
    }));
  });

  it('--credentials-json invalid JSON exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync([
      'node', 'routerly', 'add', '--provider-id', 'openai', '--label', 'Main', '--credentials-json', '{bad json',
    ])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--credentials-json'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('exits 1 with ApiError message on API failure', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(400, 'Unknown providerId'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--provider-id', 'bogus', '--label', 'X'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('400'));
  });

  it('exits 1 with generic error message on non-ApiError failure', async () => {
    mockApi.mockRejectedValueOnce(new Error('network failure'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--provider-id', 'openai', '--label', 'X'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network failure'));
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('connections remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls DELETE and prints success', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'remove', 'c1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/connections/c1');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('c1'));
  });

  it('exits 1 on 404', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'remove', 'missing-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 with generic error on non-404 failure', async () => {
    mockApi.mockRejectedValueOnce(new Error('internal error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'remove', 'c1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('internal error'));
  });
});
