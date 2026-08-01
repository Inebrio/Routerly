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

import { makeExperimentsCommand } from './experiments.js';
import type { ExperimentConfig, ExperimentMetrics, ProjectConfig } from '@routerly/shared';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeExperimentsCommand();
  cmd.exitOverride();
  return cmd;
}

/** Collects everything the command printed, so a whole table can be asserted at once. */
function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
  return lines;
}

function expectExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
}

const projects: ProjectConfig[] = [
  { id: 'p-cheap', name: 'cheap-api', models: [], timeoutMs: 2000, autoRouting: true, tokens: [], members: [], policies: [] },
  { id: 'p-premium', name: 'premium-api', models: [], timeoutMs: 2000, autoRouting: true, tokens: [], members: [], policies: [] },
];

const draft: ExperimentConfig = {
  id: 'exp-1',
  name: 'Cheap vs premium',
  description: 'Which arm answers well enough',
  status: 'draft',
  rotation: 'sticky',
  stickyKey: 'end-user',
  variants: [
    { id: 'v-a', projectId: 'p-cheap', name: 'Cheap' },
    { id: 'v-b', projectId: 'p-premium' },
  ],
  tokens: [
    { id: 't-1', token: '', tokenSnippet: 'sk-rt-abcd', createdAt: '2026-07-01T10:00:00.000Z', lastUsedAt: '2026-07-20T10:00:00.000Z' },
  ],
  judge: { enabled: true, modelId: 'gpt-4o', criteria: ['Answers the question asked'], sampleRate: 0.2 },
  createdAt: '2026-07-01T10:00:00.000Z',
};

const running: ExperimentConfig = { ...draft, status: 'running', startedAt: '2026-07-02T10:00:00.000Z' };

const metrics: ExperimentMetrics = {
  experimentId: 'exp-1',
  status: 'running',
  minSamplesPerVariant: 30,
  totalCalls: 120,
  ready: true,
  variants: [
    { variantId: 'v-a', projectId: 'p-cheap', name: 'Cheap', calls: 60, errors: 0, errorRate: 0, cost: 0.6, avgCostPerCall: 0.01, inputTokens: 100, outputTokens: 200, avgLatencyMs: 900, p95LatencyMs: 1400, judgedCalls: 10, avgScore: 6.4, enoughSamples: true },
    { variantId: 'v-b', projectId: 'p-premium', name: 'Premium', calls: 60, errors: 3, errorRate: 0.05, cost: 3, avgCostPerCall: 0.05, inputTokens: 100, outputTokens: 220, avgLatencyMs: 1500, p95LatencyMs: 2600, judgedCalls: 10, avgScore: 8.2, enoughSamples: true },
  ],
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── experiments list ──────────────────────────────────────────────────────

describe('experiments list', () => {
  it('prints one row per experiment with its status and rotation', async () => {
    mockApi.mockResolvedValueOnce([draft, running]);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('Cheap vs premium');
    expect(out).toContain('draft');
    expect(out).toContain('running');
    expect(out).toContain('Sticky per session');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/experiments');
  });

  it('filters by status', async () => {
    mockApi.mockResolvedValueOnce([draft, running]);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'list', '--status', 'running', '--json']);
    const parsed = JSON.parse(lines.join('\n')) as ExperimentConfig[];
    expect(parsed.map(e => e.status)).toEqual(['running']);
  });

  it('rejects an unknown status before calling the API', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'list', '--status', 'nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown --status "nope"'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('shows the empty state', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'list']);
    expect(lines.join('\n')).toContain('No experiments found');
  });

  it('names the module when it is disabled', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'module_disabled'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('routerly modules enable experiments'));
  });

  it('exits 1 on a non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

// ─── experiments show ──────────────────────────────────────────────────────

describe('experiments show', () => {
  it('prints the configuration, the variants and the tokens', async () => {
    mockApi.mockResolvedValueOnce(draft).mockResolvedValueOnce(projects);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'show', 'exp-1']);
    const out = lines.join('\n');
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/experiments/exp-1');
    expect(out).toContain('Cheap vs premium');
    expect(out).toContain('Sticky per session, on end user');
    expect(out).toContain('gpt-4o, 20% of calls');
    expect(out).toContain('Answers the question asked');
    expect(out).toContain('v-a');
    expect(out).toContain('premium-api');
    expect(out).toContain('sk-rt-abcd');
  });

  it('flags a variant whose project was deleted', async () => {
    mockApi.mockResolvedValueOnce(draft).mockResolvedValueOnce([projects[0]!]);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'show', 'exp-1']);
    expect(lines.join('\n')).toContain('p-premium (deleted)');
  });

  it('marks the declared winner', async () => {
    mockApi.mockResolvedValueOnce({ ...draft, status: 'closed', winnerVariantId: 'v-b' }).mockResolvedValueOnce(projects);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'show', 'exp-1']);
    expect(lines.join('\n')).toContain('winner');
  });

  it('outputs raw JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(draft);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'show', 'exp-1', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(draft);
  });
});

// ─── experiments create ────────────────────────────────────────────────────

describe('experiments create', () => {
  it('resolves the variant projects by name and prints the token once', async () => {
    mockApi.mockResolvedValueOnce(projects).mockResolvedValueOnce({ ...draft, token: 'sk-rt-plaintext' });
    const lines = capture();
    await makeCmd().parseAsync([
      'node', 'experiments', 'create', '--name', 'Cheap vs premium',
      '--variant', 'cheap-api:Cheap', '--variant', 'premium-api',
    ]);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/projects');
    expect(mockApi).toHaveBeenNthCalledWith(2, 'POST', '/api/experiments', {
      name: 'Cheap vs premium',
      variants: [{ projectId: 'p-cheap', name: 'Cheap' }, { projectId: 'p-premium' }],
    });
    const out = lines.join('\n');
    expect(out).toContain('sk-rt-plaintext');
    expect(out).toContain('routerly experiments start exp-1');
  });

  it('reads the weight off the variant spec', async () => {
    mockApi.mockResolvedValueOnce(projects).mockResolvedValueOnce({ ...draft, token: 'x' });
    await makeCmd().parseAsync([
      'node', 'experiments', 'create', '--name', 'Split', '--rotation', 'weighted',
      '--variant', 'cheap-api=80', '--variant', 'premium-api:Premium=20',
    ]);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'POST', '/api/experiments', {
      name: 'Split',
      rotation: 'weighted',
      variants: [{ projectId: 'p-cheap', weight: 80 }, { projectId: 'p-premium', name: 'Premium', weight: 20 }],
    });
  });

  it('sends the judge sample rate as a fraction', async () => {
    mockApi.mockResolvedValueOnce(projects).mockResolvedValueOnce({ ...draft, token: 'x' });
    await makeCmd().parseAsync([
      'node', 'experiments', 'create', '--name', 'Judged', '--variant', 'cheap-api', '--variant', 'premium-api',
      '--judge-model', 'gpt-4o', '--criteria', 'Stays factual', '--criteria', 'Keeps the format', '--sample-rate', '20',
    ]);
    const [, , body] = mockApi.mock.calls[1] as [string, string, { judge: unknown }];
    expect(body.judge).toEqual({ enabled: true, modelId: 'gpt-4o', criteria: ['Stays factual', 'Keeps the format'], sampleRate: 0.2 });
  });

  it('defaults the judge to every call when no rate is given', async () => {
    mockApi.mockResolvedValueOnce(projects).mockResolvedValueOnce({ ...draft, token: 'x' });
    await makeCmd().parseAsync(['node', 'experiments', 'create', '--name', 'Judged', '--variant', 'cheap-api', '--judge-model', 'gpt-4o']);
    const [, , body] = mockApi.mock.calls[1] as [string, string, { judge: { sampleRate: number } }];
    expect(body.judge.sampleRate).toBe(1);
  });

  it('rejects judge flags without a judge model', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'create', '--name', 'X', '--sample-rate', '20'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--criteria and --sample-rate need --judge-model'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('rejects an unknown project before creating anything', async () => {
    mockApi.mockResolvedValueOnce(projects);
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'create', '--name', 'X', '--variant', 'ghost'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Project "ghost" not found'));
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('rejects a negative weight', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'create', '--name', 'X', '--variant', 'cheap-api=-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid weight'));
  });

  it('rejects an unknown rotation', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'create', '--name', 'X', '--rotation', 'nope'])).rejects.toThrow('exit');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown --rotation "nope"'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('outputs raw JSON with --json', async () => {
    mockApi.mockResolvedValueOnce({ ...draft, token: 'sk-rt-plaintext' });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'create', '--name', 'X', '--json']);
    expect(JSON.parse(lines.join('\n')).token).toBe('sk-rt-plaintext');
  });
});

// ─── experiments update ────────────────────────────────────────────────────

describe('experiments update', () => {
  it('sends only the fields that were given', async () => {
    mockApi.mockResolvedValueOnce(draft);
    await makeCmd().parseAsync(['node', 'experiments', 'update', 'exp-1', '--name', 'New name', '--min-samples', '50']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/experiments/exp-1', { name: 'New name', minSamplesPerVariant: 50 });
  });

  it('disables the judge without losing its configuration', async () => {
    mockApi.mockResolvedValueOnce(draft).mockResolvedValueOnce({ ...draft, judge: { ...draft.judge!, enabled: false } });
    await makeCmd().parseAsync(['node', 'experiments', 'update', 'exp-1', '--no-judge']);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/experiments/exp-1');
    expect(mockApi).toHaveBeenNthCalledWith(2, 'PATCH', '/api/experiments/exp-1', {
      judge: { enabled: false, modelId: 'gpt-4o', criteria: ['Answers the question asked'], sampleRate: 0.2 },
    });
  });

  it('refuses to disable a judge that was never configured', async () => {
    mockApi.mockResolvedValueOnce({ ...draft, judge: undefined });
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'update', 'exp-1', '--no-judge'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no judge to disable'));
  });

  it('rejects --no-judge together with --judge-model', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'update', 'exp-1', '--no-judge', '--judge-model', 'gpt-4o'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('refuses an update with no fields', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'update', 'exp-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nothing to update'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('explains what a live experiment still accepts', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, 'experiment_frozen'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'update', 'exp-1', '--rotation', 'weighted'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no longer a draft'));
  });
});

// ─── experiments start, close, delete ──────────────────────────────────────

describe('experiments start', () => {
  it('starts the rotation', async () => {
    mockApi.mockResolvedValueOnce(running);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'start', 'exp-1']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/experiments/exp-1/start');
    expect(lines.join('\n')).toContain('is running');
  });

  it('says how to add the missing variants', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(400, 'too_few_variants'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'start', 'exp-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('at least two variants'));
  });
});

describe('experiments close', () => {
  it('closes without a winner', async () => {
    mockApi.mockResolvedValueOnce({ ...running, status: 'closed' });
    await makeCmd().parseAsync(['node', 'experiments', 'close', 'exp-1']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/experiments/exp-1/close', {});
  });

  it('records the winning variant', async () => {
    mockApi.mockResolvedValueOnce(running).mockResolvedValueOnce({ ...running, status: 'closed', winnerVariantId: 'v-a' });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'close', 'exp-1', '--winner', 'v-a']);
    expect(mockApi).toHaveBeenLastCalledWith('POST', '/api/experiments/exp-1/close', { winnerVariantId: 'v-a' });
    expect(lines.join('\n')).toContain('winner: Cheap');
  });

  it('takes the winner by label too', async () => {
    mockApi.mockResolvedValueOnce(running).mockResolvedValueOnce({ ...running, status: 'closed', winnerVariantId: 'v-a' });
    capture();
    await makeCmd().parseAsync(['node', 'experiments', 'close', 'exp-1', '--winner', 'cheap']);
    expect(mockApi).toHaveBeenLastCalledWith('POST', '/api/experiments/exp-1/close', { winnerVariantId: 'v-a' });
  });

  it('points at show when the winner is not one of the variants', async () => {
    mockApi.mockResolvedValueOnce(running);
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'close', 'exp-1', '--winner', 'ghost'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('experiments show exp-1'));
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('points at show when the variant vanished between the read and the close', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce(running).mockRejectedValueOnce(new ApiError(404, 'variant_not_found'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'close', 'exp-1', '--winner', 'v-a'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('experiments show'));
  });
});

describe('experiments delete', () => {
  it('deletes a closed experiment', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'delete', 'exp-1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/experiments/exp-1');
    expect(lines.join('\n')).toContain('deleted');
  });

  it('asks for a close first when it is still running', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, 'experiment_running'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'delete', 'exp-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('routerly experiments close exp-1'));
  });
});

// ─── experiments metrics ───────────────────────────────────────────────────

describe('experiments metrics', () => {
  it('prints one row per variant', async () => {
    mockApi.mockResolvedValueOnce(metrics);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/experiments/exp-1/metrics');
    const out = lines.join('\n');
    expect(out).toContain('120 calls measured');
    expect(out).toContain('Cheap');
    expect(out).toContain('$0.60');
    expect(out).toContain('3 (5.0%)');
    expect(out).toContain('900 ms');
    expect(out).toContain('6.4 / 10 (10)');
  });

  it('turns --days into an ISO window', async () => {
    mockApi.mockResolvedValueOnce(metrics);
    await makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1', '--days', '7']);
    const [, path] = mockApi.mock.calls[0] as [string, string];
    const from = new URL(`http://x${path}`).searchParams.get('from')!;
    expect(Date.now() - new Date(from).getTime()).toBeCloseTo(7 * 86_400_000, -4);
  });

  it('passes an explicit window through', async () => {
    mockApi.mockResolvedValueOnce(metrics);
    await makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1', '--from', '2026-08-01T00:00:00Z', '--to', '2026-08-02T00:00:00Z']);
    const [, path] = mockApi.mock.calls[0] as [string, string];
    expect(path).toContain('from=2026-08-01T00%3A00%3A00.000Z');
    expect(path).toContain('to=2026-08-02T00%3A00%3A00.000Z');
  });

  it('rejects a date it cannot read', async () => {
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1', '--from', 'yesterday'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Expected an ISO 8601 date'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('flags a comparison that is not conclusive yet', async () => {
    mockApi.mockResolvedValueOnce({
      ...metrics, ready: false,
      variants: [{ ...metrics.variants[0]!, calls: 4, enoughSamples: false }, metrics.variants[1]!],
    });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1']);
    const out = lines.join('\n');
    expect(out).toContain('low sample');
    expect(out).toContain('at least 30 calls');
  });

  it('shows the empty state before any call lands', async () => {
    mockApi.mockResolvedValueOnce({ ...metrics, totalCalls: 0, variants: [] });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1']);
    expect(lines.join('\n')).toContain('No calls in this window yet');
  });

  it('outputs raw JSON with --json', async () => {
    mockApi.mockResolvedValueOnce(metrics);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'metrics', 'exp-1', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(metrics);
  });
});

// ─── experiments token ─────────────────────────────────────────────────────

describe('experiments token', () => {
  it('lists the tokens with their snippet and usage dates', async () => {
    mockApi.mockResolvedValueOnce(draft);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'token', 'list', 'exp-1']);
    expect(lines.join('\n')).toContain('sk-rt-abcd');
  });

  it('says when a token has never been used', async () => {
    mockApi.mockResolvedValueOnce({ ...draft, tokens: [{ ...draft.tokens[0]!, lastUsedAt: undefined }] });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'token', 'list', 'exp-1']);
    expect(lines.join('\n')).toContain('never');
  });

  it('shows the empty state with no tokens', async () => {
    mockApi.mockResolvedValueOnce({ ...draft, tokens: [] });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'token', 'list', 'exp-1']);
    expect(lines.join('\n')).toContain('No tokens on this experiment');
  });

  it('creates a token and prints it once', async () => {
    mockApi.mockResolvedValueOnce({ token: 'sk-rt-new', tokenInfo: { id: 't-2', tokenSnippet: 'sk-rt-new1', createdAt: '2026-08-01T10:00:00.000Z' } });
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'token', 'create', 'exp-1']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/experiments/exp-1/tokens');
    expect(lines.join('\n')).toContain('sk-rt-new');
  });

  it('revokes a token', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const lines = capture();
    await makeCmd().parseAsync(['node', 'experiments', 'token', 'revoke', 'exp-1', 't-1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/experiments/exp-1/tokens/t-1');
    expect(lines.join('\n')).toContain('revoked');
  });

  it('exits 1 when the token is gone', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Token not found'));
    const exitSpy = expectExit();
    await expect(makeCmd().parseAsync(['node', 'experiments', 'token', 'revoke', 'exp-1', 'ghost'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Token not found'));
  });
});
