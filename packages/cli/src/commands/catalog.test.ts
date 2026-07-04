import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeCatalogCommand } from './catalog.js';

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

import { api } from '../api.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

// ── repos list ────────────────────────────────────────────────────────────────

describe('catalog repos list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table with repos', async () => {
    mockApi.mockResolvedValueOnce({ providerRepos: [
      { url: 'https://example.com/repo', channel: 'stable', enabled: true },
    ]});
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'list']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/settings');
    expect(console.log).toHaveBeenCalled();
  });

  it('prints message when empty', async () => {
    mockApi.mockResolvedValueOnce({ providerRepos: [] });
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No catalog repositories'));
  });

  it('handles missing providerRepos key', async () => {
    mockApi.mockResolvedValueOnce({});
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No catalog repositories'));
  });

  it('outputs JSON with --json flag', async () => {
    const repos = [{ url: 'https://example.com/repo', enabled: true }];
    mockApi.mockResolvedValueOnce({ providerRepos: repos });
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'list', '--json']);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(repos, null, 2));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('Network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeCatalogCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'repos', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── repos add ─────────────────────────────────────────────────────────────────

describe('catalog repos add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('adds a new repo', async () => {
    mockApi
      .mockResolvedValueOnce({ providerRepos: [] })   // GET
      .mockResolvedValueOnce({});                      // PUT
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'add', 'https://example.com/repo']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', {
      providerRepos: [{ url: 'https://example.com/repo', enabled: true }],
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Added: https://example.com/repo'));
  });

  it('adds with --channel', async () => {
    mockApi
      .mockResolvedValueOnce({ providerRepos: [] })
      .mockResolvedValueOnce({});
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'add', 'https://example.com/repo', '--channel', 'stable']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', {
      providerRepos: [{ url: 'https://example.com/repo', channel: 'stable', enabled: true }],
    });
  });

  it('exits 1 if URL already exists', async () => {
    mockApi.mockResolvedValueOnce({ providerRepos: [{ url: 'https://example.com/repo', enabled: true }] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeCatalogCommand();
    await expect(
      cmd.parseAsync(['node', 'routerly', 'repos', 'add', 'https://example.com/repo'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });
});

// ── repos remove ──────────────────────────────────────────────────────────────

describe('catalog repos remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes existing repo', async () => {
    mockApi
      .mockResolvedValueOnce({ providerRepos: [{ url: 'https://example.com/repo', enabled: true }] })
      .mockResolvedValueOnce({});
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'remove', 'https://example.com/repo']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', { providerRepos: [] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Removed'));
  });

  it('exits 1 when URL not found', async () => {
    mockApi.mockResolvedValueOnce({ providerRepos: [] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeCatalogCommand();
    await expect(
      cmd.parseAsync(['node', 'routerly', 'repos', 'remove', 'https://missing.com/repo'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

// ── repos enable / disable ────────────────────────────────────────────────────

describe('catalog repos enable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sets enabled=true', async () => {
    mockApi
      .mockResolvedValueOnce({ providerRepos: [{ url: 'https://example.com/repo', enabled: false }] })
      .mockResolvedValueOnce({});
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'enable', 'https://example.com/repo']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', {
      providerRepos: [{ url: 'https://example.com/repo', enabled: true }],
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Enabled'));
  });

  it('exits 1 when URL not found', async () => {
    mockApi.mockResolvedValueOnce({ providerRepos: [] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeCatalogCommand();
    await expect(
      cmd.parseAsync(['node', 'routerly', 'repos', 'enable', 'https://missing.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('catalog repos disable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sets enabled=false', async () => {
    mockApi
      .mockResolvedValueOnce({ providerRepos: [{ url: 'https://example.com/repo', enabled: true }] })
      .mockResolvedValueOnce({});
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'repos', 'disable', 'https://example.com/repo']);
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/settings', {
      providerRepos: [{ url: 'https://example.com/repo', enabled: false }],
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Disabled'));
  });

  it('exits 1 when URL not found', async () => {
    mockApi.mockResolvedValueOnce({ providerRepos: [] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeCatalogCommand();
    await expect(
      cmd.parseAsync(['node', 'routerly', 'repos', 'disable', 'https://missing.com'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── refresh ───────────────────────────────────────────────────────────────────

describe('catalog refresh', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('POSTs to /api/catalog/refresh and prints success', async () => {
    mockApi.mockResolvedValueOnce({ ok: true });
    const cmd = makeCatalogCommand();
    await cmd.parseAsync(['node', 'routerly', 'refresh']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/catalog/refresh');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Catalog cache refreshed'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('Connection refused'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeCatalogCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'refresh'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
