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

import { makeOptimizersCommand } from './optimizers.js';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeOptimizersCommand();
  cmd.exitOverride();
  return cmd;
}

const installed = [
  { id: 'session-dedup', klass: 'lossless', installed: true },
  { id: 'ccr', klass: 'recoverable', installed: true },
];

const baseProject = {
  id: 'proj-1',
  name: 'my-api',
  models: [{ modelId: 'gpt-4o' }],
  timeoutMs: 5000,
  autoRouting: true,
  tokens: [],
  members: [],
  policies: [],
};

// ─── optimizers list ─────────────────────────────────────────────────────────

describe('optimizers list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints installed optimizers in a table', async () => {
    mockApi.mockResolvedValueOnce(installed);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('session-dedup');
    expect(out).toContain('ccr');
    expect(out).toContain('lossless');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/optimizers');
  });

  it('names each optimizer and says what its threshold means', async () => {
    mockApi.mockResolvedValueOnce(installed);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('Conversation Context');   // catalog label, wrapped by the table
    expect(out).toContain('1-50 turns');
    expect(out).toContain('default 6');
    // session-dedup takes no threshold
    expect(out).toContain('-');
  });

  it('outputs valid JSON with --json, enriched from the catalog', async () => {
    mockApi.mockResolvedValueOnce(installed);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'list', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: 'session-dedup', klass: 'lossless', installed: true });
    expect(parsed[0].threshold).toBeUndefined();
    expect(parsed[1]).toMatchObject({ id: 'ccr', label: 'Conversation Context Reduction' });
    expect(parsed[1].threshold).toMatchObject({ unit: 'turns', min: 1, max: 50, default: 6 });
  });

  it('shows empty state when none installed', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'list']);
    expect(lines.join('\n')).toContain('No optimizers installed');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });
});

// ─── optimizers config ───────────────────────────────────────────────────────

describe('optimizers config', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('enables a step and combines with a threshold in one PUT', async () => {
    const updated = { ...baseProject, optimizers: { steps: [{ id: 'ccr', enabled: true, threshold: 8 }] } };
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(updated);
    await makeCmd().parseAsync(['node', 'optimizers', 'config', 'my-api', '--enable', 'ccr', '--threshold', 'ccr=8']);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/projects');
    const putCall = mockApi.mock.calls[1]!;
    expect(putCall[0]).toBe('PUT');
    expect(putCall[1]).toBe('/api/projects/proj-1');
    expect(putCall[2].optimizers).toEqual({ steps: [{ id: 'ccr', enabled: true, threshold: 8 }] });
    expect(putCall[2].name).toBe('my-api');
    expect(putCall[2].models).toEqual([{ modelId: 'gpt-4o' }]);
  });

  it('merges enable/disable onto existing steps without dropping them', async () => {
    const existing = { ...baseProject, optimizers: { steps: [{ id: 'ccr', enabled: true }, { id: 'rtk', enabled: true }] } };
    mockApi.mockResolvedValueOnce([existing]).mockResolvedValueOnce(existing);
    await makeCmd().parseAsync(['node', 'optimizers', 'config', 'my-api', '--disable', 'rtk', '--enable', 'headroom']);
    const body = mockApi.mock.calls[1]![2];
    expect(body.optimizers.steps).toEqual([
      { id: 'ccr', enabled: true },
      { id: 'rtk', enabled: false },
      { id: 'headroom', enabled: true },
    ]);
  });

  it('reorders steps per --order, unmentioned kept at the end in original order', async () => {
    const existing = {
      ...baseProject,
      optimizers: { steps: [{ id: 'ccr', enabled: true }, { id: 'rtk', enabled: true }, { id: 'headroom', enabled: true }] },
    };
    mockApi.mockResolvedValueOnce([existing]).mockResolvedValueOnce(existing);
    await makeCmd().parseAsync(['node', 'optimizers', 'config', 'my-api', '--order', 'headroom,ccr']);
    const body = mockApi.mock.calls[1]![2];
    expect(body.optimizers.steps.map((s: { id: string }) => s.id)).toEqual(['headroom', 'ccr', 'rtk']);
  });

  it('outputs valid JSON with --json', async () => {
    const updated = { ...baseProject, optimizers: { steps: [{ id: 'ccr', enabled: true }] } };
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(updated);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'config', 'my-api', '--enable', 'ccr', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(updated);
  });

  it('rejects a malformed --threshold', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'config', 'my-api', '--threshold', 'ccr=notanumber'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('invalid --threshold'));
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'config', 'no-such', '--enable', 'ccr'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on ApiError from PUT', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'optimizers:manage required'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'config', 'my-api', '--enable', 'ccr'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('optimizers:manage required'));
  });
});

// ─── optimizers samples ──────────────────────────────────────────────────────

describe('optimizers samples', () => {
  const captured = [
    { capturedAt: '2026-08-01T10:00:00.000Z', messages: [{ role: 'user', content: 'first prompt' }], estimatedTokens: 4 },
    { capturedAt: '2026-08-01T09:00:00.000Z', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'second' }], estimatedTokens: 6, truncated: true },
  ];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('lists the prompts the service kept for the project', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(captured);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'GET', '/api/projects/proj-1/optimizers/samples');
    const out = lines.join('\n');
    expect(out).toContain('2026-08-01T10:00:00.000Z');
    expect(out).toContain('yes');   // the second sample is an excerpt
  });

  it('prints one prompt in full with --show', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(captured);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api', '--show', '2']);
    const out = lines.join('\n');
    expect(out).toContain('system');
    expect(out).toContain('be brief');
    expect(out).toContain('second');
  });

  it('exits 1 when --show points past the end', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(captured);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api', '--show', '9'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('This project has 2'));
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(captured);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(captured);
  });

  it('says nothing was captured yet on a silent project', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api']);
    expect(lines.join('\n')).toContain('No prompts captured yet');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'optimizers:read required'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('optimizers:read required'));
  });
});

// ─── optimizers preview ──────────────────────────────────────────────────────

describe('optimizers preview', () => {
  const previewResult = {
    estimatedTokensBefore: 100,
    estimatedTokensAfter: 60,
    perStep: [{ id: 'ccr', before: 100, after: 60 }],
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends the project steps + user messages and prints deltas', async () => {
    const project = { ...baseProject, optimizers: { steps: [{ id: 'ccr', enabled: true }] } };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(previewResult);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hello', '--message', 'world']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'POST', '/api/optimizers/preview', {
      projectId: 'proj-1',
      sampleMessages: [
        { role: 'user', content: 'hello' },
        { role: 'user', content: 'world' },
      ],
      steps: [{ id: 'ccr', enabled: true }],
    });
    const out = lines.join('\n');
    expect(out).toContain('100');
    expect(out).toContain('60');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(previewResult);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hi', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(previewResult);
  });

  it('exits 1 when neither --message nor --sample is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--sample'));
  });

  it('exits 1 when --message and --sample are combined', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hi', '--sample', '1'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
  });

  it('replays a captured prompt with --sample', async () => {
    const project = { ...baseProject, optimizers: { steps: [{ id: 'ccr', enabled: true }] } };
    const captured = [
      { capturedAt: '2026-08-01T10:00:00.000Z', messages: [{ role: 'user', content: 'real traffic' }], estimatedTokens: 3 },
    ];
    mockApi
      .mockResolvedValueOnce([project])
      .mockResolvedValueOnce(captured)
      .mockResolvedValueOnce(previewResult);
    await makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--sample', '1']);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'GET', '/api/projects/proj-1/optimizers/samples');
    expect(mockApi).toHaveBeenNthCalledWith(3, 'POST', '/api/optimizers/preview', {
      projectId: 'proj-1',
      sampleMessages: [{ role: 'user', content: 'real traffic' }],
      steps: [{ id: 'ccr', enabled: true }],
    });
  });

  it('exits 1 when the --sample index has no prompt behind it', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--sample', '3'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no sample 3'));
  });

  it('shows what each step saved, and flags a rolled-back one', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({
      estimatedTokensBefore: 100,
      estimatedTokensAfter: 60,
      perStep: [
        { id: 'ccr', before: 100, after: 60 },
        { id: 'caveman', before: 60, after: 60, rolledBack: true },
      ],
    });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hi']);
    const out = lines.join('\n');
    expect(out).toContain('40');            // ccr saved column
    expect(out).toContain('rolled back');
    expect(out).toContain('judged unsafe');
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'preview', 'no-such', '--message', 'hi'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on ApiError from preview', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(400, 'bad preview'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hi'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('bad preview'));
  });
});
