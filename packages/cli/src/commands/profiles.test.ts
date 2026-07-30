import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: vi.fn(),
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
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test',
    serverUrl: 'http://localhost:3000',
    email: 'admin@example.com',
    token: 'jwt-test',
    expiresAt: Date.now() + 3_600_000,
  }),
}));

import { makeProfilesCommand } from './profiles.js';
import type { RoutingProfile } from '@routerly/shared';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeProfilesCommand();
  cmd.exitOverride();
  return cmd;
}

const builtinProfile: RoutingProfile = {
  id: 'balanced',
  version: 1,
  label: 'Balanced',
  policies: [{ type: 'health', enabled: true }, { type: 'cheapest', enabled: false }],
  selector: 'argmax',
  fallbackStrategy: 'next-best',
  builtin: true,
};

const userProfile: RoutingProfile = {
  id: 'user-1',
  version: 1,
  label: 'My Custom',
  policies: [],
  selector: 'weighted-random',
  fallbackStrategy: 'abort',
  builtin: false,
  baseId: 'balanced',
};

const baseProject = {
  id: 'proj-1',
  name: 'my-api',
  models: [],
  timeoutMs: 5000,
  autoRouting: true,
  tokens: [],
  members: [],
  policies: [],
};

// ─── profiles list ─────────────────────────────────────────────────────────

describe('profiles list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints built-in and user rows in a table', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('Balanced');
    expect(out).toContain('My Custom');
    expect(out).toContain('yes');
    expect(out).toContain('no');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/routing/profiles');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'list', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed).toEqual([builtinProfile, userProfile]);
  });

  it('shows empty state when no profiles', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'list']);
    expect(lines.join('\n')).toContain('No routing profiles found');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

// ─── profiles show ─────────────────────────────────────────────────────────

describe('profiles show', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows key/value details and policies for a found profile', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'balanced']);
    const out = lines.join('\n');
    expect(out).toContain('Balanced');
    expect(out).toContain('argmax');
    expect(out).toContain('next-best');
    expect(out).toContain('health (enabled)');
    expect(out).toContain('cheapest (disabled)');
  });

  it('shows baseId when present', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'user-1']);
    const out = lines.join('\n');
    expect(out).toContain('baseId');
    expect(out).toContain('balanced');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'balanced', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(builtinProfile);
  });

  it('unknown id -> stderr + exit 1', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'show', 'no-such-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'show', 'balanced'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });
});

// ─── profiles clone ────────────────────────────────────────────────────────

describe('profiles clone', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('clones a profile and prints confirmation', async () => {
    mockApi.mockResolvedValueOnce(userProfile);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'clone', 'balanced', '--label', 'My Custom']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/routing/profiles/clone', { baseId: 'balanced', label: 'My Custom' });
    expect(lines.join('\n')).toContain('Cloned profile "balanced" -> user-1');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(userProfile);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'clone', 'balanced', '--label', 'My Custom', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(userProfile);
  });

  it('errors when --label is missing (Commander required option)', async () => {
    await expect(makeCmd().parseAsync(['node', 'profiles', 'clone', 'balanced'])).rejects.toThrow();
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(404, 'base profile not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'clone', 'no-such', '--label', 'X'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('base profile not found'));
  });
});

// ─── profiles set ──────────────────────────────────────────────────────────

describe('profiles set', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls the assign endpoint with the resolved project id and profileId', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({ ...baseProject, routingProfileId: 'balanced' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'balanced']);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/projects');
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profile', { profileId: 'balanced' });
    expect(lines.join('\n')).toContain('set to "balanced"');
  });

  it('clears the profile with --none', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({ ...baseProject, routingProfileId: null });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', '--none']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profile', { profileId: null });
    expect(lines.join('\n')).toContain('cleared');
  });

  it('--none wins when both profileId and --none are given', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({ ...baseProject, routingProfileId: null });
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'balanced', '--none']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profile', { profileId: null });
  });

  it('outputs valid JSON with --json', async () => {
    const updated = { ...baseProject, routingProfileId: 'balanced' };
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(updated);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'balanced', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(updated);
  });

  it('errors when neither profileId nor --none is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('provide a profileId or --none'));
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'no-such', 'balanced'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on ApiError from assign call', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(400, 'invalid profile'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'bad-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('invalid profile'));
  });
});
