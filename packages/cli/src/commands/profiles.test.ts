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
import type { OptimizerProfile, RoutingProfile, SecurityProfile } from '@routerly/shared';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeProfilesCommand();
  cmd.exitOverride();
  return cmd;
}

const builtinProfile: RoutingProfile = {
  id: 'auto',
  kind: 'routing',
  version: 1,
  label: 'Auto',
  policies: [{ type: 'health', enabled: true }, { type: 'cheapest', enabled: false }],
  selector: 'argmax',
  fallbackStrategy: 'next-best',
  builtin: true,
};

const userProfile: RoutingProfile = {
  id: 'user-1',
  kind: 'routing',
  version: 1,
  label: 'My Custom',
  policies: [],
  selector: 'weighted-random',
  fallbackStrategy: 'abort',
  builtin: false,
  baseId: 'auto',
};

const optimizerProfile: OptimizerProfile = {
  id: 'optimizer-balanced',
  kind: 'optimizer',
  version: 1,
  label: 'Optimizer Balanced',
  builtin: true,
  optimizers: {
    steps: [
      { id: 'session-dedup', enabled: true },
      { id: 'headroom', enabled: true, threshold: 0.8 },
      { id: 'ccr', enabled: false },
    ],
  },
};

const securityProfile: SecurityProfile = {
  id: 'security-standard',
  kind: 'security',
  version: 1,
  label: 'Security Standard',
  builtin: true,
  guardrails: {
    detectInjection: true,
    rules: [{ type: 'regex', target: 'request', block: true, log: true, config: { patterns: ['secret'] } }],
  },
  pii: {
    policies: [{ entities: ['EMAIL'], target: 'both' }],
  },
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

  it('prints one row per profile with its kind and summary', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile, optimizerProfile, securityProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('Auto');
    expect(out).toContain('My Custom');
    expect(out).toContain('routing');
    expect(out).toContain('optimizer');
    expect(out).toContain('security');
    expect(out).toContain('1 active policies');
    expect(out).toContain('2/3 steps enabled');
    expect(out).toContain('1 guardrail rules, 1 PII policies');
    expect(out).toContain('yes');
    expect(out).toContain('no');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/profiles');
  });

  it('passes the kind filter as a query parameter', async () => {
    mockApi.mockResolvedValueOnce([optimizerProfile]);
    await makeCmd().parseAsync(['node', 'profiles', 'list', '--kind', 'optimizer']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/profiles?kind=optimizer');
  });

  it('rejects an unknown kind before calling the API', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'list', '--kind', 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown kind "nope"'));
    expect(mockApi).not.toHaveBeenCalled();
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
    expect(lines.join('\n')).toContain('No profiles found');
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

  it('shows selector, fallback and policies for a routing profile', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'auto']);
    const out = lines.join('\n');
    expect(out).toContain('Auto');
    expect(out).toContain('routing');
    expect(out).toContain('argmax');
    expect(out).toContain('next-best');
    expect(out).toContain('health (enabled)');
    expect(out).toContain('cheapest (disabled)');
  });

  it('shows the step pipeline for an optimizer profile', async () => {
    mockApi.mockResolvedValueOnce([optimizerProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'optimizer-balanced']);
    const out = lines.join('\n');
    expect(out).toContain('session-dedup (enabled)');
    expect(out).toContain('headroom (enabled, threshold 0.8)');
    expect(out).toContain('ccr (disabled)');
  });

  it('shows guardrail rules and PII policies for a security profile', async () => {
    mockApi.mockResolvedValueOnce([securityProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'security-standard']);
    const out = lines.join('\n');
    expect(out).toContain('detectInjection');
    expect(out).toContain('regex on request, block+log (enabled)');
    expect(out).toContain('EMAIL (both, enabled)');
  });

  it('renders empty sections for a profile with nothing configured', async () => {
    const empty: SecurityProfile = {
      ...securityProfile, id: 'empty', guardrails: { rules: [] }, pii: { policies: [] },
    };
    mockApi.mockResolvedValueOnce([empty, { ...optimizerProfile, id: 'empty-opt', optimizers: { steps: [] } }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'empty']);
    expect(lines.join('\n')).toContain('(none)');
  });

  it('renders an empty optimizer pipeline and an empty routing policy list', async () => {
    mockApi
      .mockResolvedValueOnce([{ ...optimizerProfile, id: 'empty-opt', optimizers: { steps: [] } }])
      .mockResolvedValueOnce([userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'empty-opt']);
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'user-1']);
    expect(lines.join('\n')).toContain('(none)');
  });

  it('shows baseId when present', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile, userProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'user-1']);
    const out = lines.join('\n');
    expect(out).toContain('baseId');
    expect(out).toContain('auto');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([builtinProfile]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'show', 'auto', '--json']);
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
    await expect(makeCmd().parseAsync(['node', 'profiles', 'show', 'auto'])).rejects.toThrow('exit');
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

  it('clones a profile and prints the kind it produced', async () => {
    mockApi.mockResolvedValueOnce(userProfile);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'clone', 'auto', '--label', 'My Custom']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/profiles/clone', { baseId: 'auto', label: 'My Custom' });
    expect(lines.join('\n')).toContain('Cloned routing profile "auto" -> user-1');
  });

  it('clones an optimizer profile through the same endpoint', async () => {
    mockApi.mockResolvedValueOnce({ ...optimizerProfile, id: 'opt-clone', builtin: false, baseId: 'optimizer-balanced' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'clone', 'optimizer-balanced', '--label', 'Mine']);
    expect(lines.join('\n')).toContain('Cloned optimizer profile');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(userProfile);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'clone', 'auto', '--label', 'My Custom', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(userProfile);
  });

  it('errors when --label is missing (Commander required option)', async () => {
    await expect(makeCmd().parseAsync(['node', 'profiles', 'clone', 'auto'])).rejects.toThrow();
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(400, 'unknown_base_profile: no-such'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'clone', 'no-such', '--label', 'X'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unknown_base_profile'));
  });
});

// ─── profiles delete ───────────────────────────────────────────────────────

describe('profiles delete', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('deletes a user profile', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'delete', 'user-1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/profiles/user-1');
    expect(lines.join('\n')).toContain('deleted');
  });

  it('explains a 409 profile_in_use', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, 'profile_in_use'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'delete', 'user-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('still assigned to a project'));
  });

  it('exits 1 when the profile is a built-in', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, 'immutable_builtin_profile'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'delete', 'auto'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('immutable_builtin_profile'));
  });
});

// ─── profiles set ──────────────────────────────────────────────────────────

describe('profiles set', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('assigns the routing profile of the resolved project', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({ ...baseProject, routingProfileId: 'auto' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'routing', 'auto']);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/projects');
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profiles', { routing: 'auto' });
    expect(lines.join('\n')).toContain('routing profile set to "auto"');
  });

  it('assigns an optimizer profile under its own key', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({ ...baseProject, optimizerProfileId: 'optimizer-balanced' });
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'optimizer', 'optimizer-balanced']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profiles', { optimizer: 'optimizer-balanced' });
  });

  it('clears one kind with --none', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(baseProject);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'security', '--none']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profiles', { security: null });
    expect(lines.join('\n')).toContain('security profile cleared');
  });

  it('--none wins when both profileId and --none are given', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(baseProject);
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'routing', 'auto', '--none']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PUT', '/api/projects/proj-1/profiles', { routing: null });
  });

  it('outputs valid JSON with --json', async () => {
    const updated = { ...baseProject, routingProfileId: 'auto' };
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(updated);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'routing', 'auto', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(updated);
  });

  it('rejects an unknown kind before resolving the project', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'nope', 'auto'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown kind "nope"'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('errors when neither profileId nor --none is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'routing'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('provide a profileId or --none'));
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'no-such', 'routing', 'auto'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on ApiError from the assign call', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(404, 'profile_not_found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'set', 'my-api', 'routing', 'bad-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('profile_not_found'));
  });
});

// ─── profiles get ──────────────────────────────────────────────────────────

describe('profiles get', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints one row per kind, custom when unbound', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, routingProfileId: 'auto' }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'get', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('auto');
    expect(out).toContain('optimizer');
    expect(out).toContain('custom');
  });

  it('outputs the bindings as JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, routingProfileId: 'auto', securityProfileId: 'security-strict' }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'profiles', 'get', 'my-api', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual({ routing: 'auto', optimizer: null, security: 'security-strict' });
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'profiles', 'get', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});
