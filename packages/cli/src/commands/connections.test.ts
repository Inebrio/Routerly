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

  it('strips a credentials field from --json output even if the server sent one', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'c1', providerId: 'openai', label: 'Main', enabled: true, credentials: { apiKey: 'sk-leaked-secret' } },
    ]);
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list', '--json']);
    const printed = vi.mocked(console.log).mock.calls.map(c => c.join(' ')).join('\n');
    expect(printed).not.toContain('credentials');
    expect(printed).not.toContain('sk-leaked-secret');
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

  it('builds the credentials object from cloud (bedrock) flags', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c5', providerId: 'bedrock', label: 'AWS', credentials: undefined, enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--provider-id', 'bedrock', '--label', 'AWS',
      '--aws-region', 'us-east-1', '--aws-access-key-id', 'AKIA', '--aws-secret-access-key', 'secret',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/connections', expect.objectContaining({
      credentials: { awsRegion: 'us-east-1', awsAccessKeyId: 'AKIA', awsSecretAccessKey: 'secret' },
    }));
  });

  it('only includes credential keys the user passed', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c6', providerId: 'azure', label: 'Az', credentials: undefined, enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--provider-id', 'azure', '--label', 'Az',
      '--azure-resource-name', 'res', '--api-key', 'k',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/connections', expect.objectContaining({
      credentials: { apiKey: 'k', azureResourceName: 'res' },
    }));
  });
});

// ── edit ──────────────────────────────────────────────────────────────────────

describe('connections edit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('PATCHes only the fields passed (label only)', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c1', providerId: 'openai', label: 'New', enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'edit', 'c1', '--label', 'New']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/connections/c1', { label: 'New' });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('updated'));
  });

  it('includes a credentials object only when a credential flag is passed', async () => {
    mockApi.mockResolvedValueOnce({ id: 'c1', providerId: 'openai', label: 'M', enabled: true });
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'edit', 'c1', '--api-key', 'sk-new', '--no-enabled']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/connections/c1', {
      enabled: false,
      credentials: { apiKey: 'sk-new' },
    });
  });

  it('errors and exits 1 when nothing is passed', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'edit', 'c1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nothing to update'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('handles 404 like remove', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'edit', 'missing', '--label', 'X'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('--credentials-json invalid JSON exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync([
      'node', 'routerly', 'edit', 'c1', '--credentials-json', '{bad',
    ])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--credentials-json'));
    expect(mockApi).not.toHaveBeenCalled();
  });
});

// ── show ──────────────────────────────────────────────────────────────────────

describe('connections show', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints a detail view and strips credentials (--json)', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'c1', providerId: 'openai', label: 'Main', enabled: true, credentials: { apiKey: 'sk-leaked-secret' } },
    ]);
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'show', 'c1', '--json']);
    const printed = vi.mocked(console.log).mock.calls.map(c => c.join(' ')).join('\n');
    expect(printed).toContain('"c1"');
    expect(printed).not.toContain('credentials');
    expect(printed).not.toContain('sk-leaked-secret');
  });

  it('prints a detail view without credentials (table)', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'c1', providerId: 'openai', label: 'Main', enabled: true, credentials: { apiKey: 'sk-leaked-secret' } },
    ]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeConnectionsCommand();
    await cmd.parseAsync(['node', 'routerly', 'show', 'c1']);
    const out = lines.join('\n');
    expect(out).toContain('c1');
    expect(out).toContain('openai');
    expect(out).not.toContain('sk-leaked-secret');
  });

  it('exits 1 when the connection is not found', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'c1', providerId: 'openai', label: 'Main', enabled: true }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeConnectionsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'show', 'missing'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
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
