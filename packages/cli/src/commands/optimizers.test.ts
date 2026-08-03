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

// ─── optimizers fixtures ─────────────────────────────────────────────────────

describe('optimizers fixtures', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('lists the shipped conversations without calling the service', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'fixtures']);
    const out = lines.join('\n');
    expect(out).toContain('support-chat-en');
    expect(out).toContain('brief-en');
    expect(out).toContain('agent-tools-en');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('outputs valid JSON with --json', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'fixtures', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.map((f: { id: string }) => f.id)).toEqual(['support-chat-en', 'brief-en', 'agent-tools-en']);
    expect(parsed[0].messages.length).toBeGreaterThan(0);
  });

  it('has no traffic-sample command: real prompts are never buffered', async () => {
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'samples', 'my-api'])).rejects.toThrow();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

// ─── optimizers model ────────────────────────────────────────────────────────

describe('optimizers model', () => {
  const state = { state: 'absent', modelId: 'microsoft/llmlingua-2', dtype: 'q8', runtimeInstalled: true };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reports the checkpoint state on the service host', async () => {
    mockApi.mockResolvedValueOnce(state);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'model']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/optimizers/llmlingua2/model');
    const out = lines.join('\n');
    expect(out).toContain('microsoft/llmlingua-2');
    expect(out).toContain('absent');
    expect(out).toContain('installed');
  });

  it('starts the download with --install and says it is polled', async () => {
    mockApi.mockResolvedValueOnce({ ...state, state: 'downloading' });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'model', '--install']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/optimizers/llmlingua2/model', {});
    expect(lines.join('\n')).toContain('again to check progress');
  });

  it('outputs valid JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(state);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'model', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(state);
  });

  it('exits 1 when the runtime is missing on the host', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, '@huggingface/transformers is not installed on the service host'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'model', '--install'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not installed on the service host'));
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

  it('exits 1 when neither --message nor --fixture is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--fixture'));
  });

  it('exits 1 when --message and --fixture are combined', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hi', '--fixture', 'brief-en'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
  });

  it('sends a shipped conversation with --fixture', async () => {
    const project = { ...baseProject, optimizers: { steps: [{ id: 'ccr', enabled: true }] } };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(previewResult);
    await makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--fixture', 'support-chat-en']);
    const body = mockApi.mock.calls[1]![2];
    expect(mockApi.mock.calls[1]![1]).toBe('/api/optimizers/preview');
    expect(body.sampleMessages[0].role).toBe('system');
    expect(body.sampleMessages.length).toBeGreaterThan(6);
    expect(body.steps).toEqual([{ id: 'ccr', enabled: true }]);
  });

  it('exits 1 on an unknown --fixture id, without calling the service', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--fixture', 'nope'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unknown fixture "nope"'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('shows what each step saved, flags a rolled-back one and explains a skip', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce({
      estimatedTokensBefore: 100,
      estimatedTokensAfter: 60,
      perStep: [
        { id: 'ccr', before: 100, after: 60 },
        { id: 'caveman', before: 60, after: 60, rolledBack: true },
        { id: 'llmlingua-2', before: 60, after: 60, skipReason: 'model not installed on this host' },
      ],
    });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'optimizers', 'preview', 'my-api', '--message', 'hi']);
    const out = lines.join('\n');
    expect(out).toContain('40');            // ccr saved column
    expect(out).toContain('rolled back');
    expect(out).toContain('judged unsafe');
    expect(out).toContain('model not installed');
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
