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

import { makeReportCommand } from './report.js';

afterEach(() => vi.clearAllMocks());

function setup() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
}

async function run(...args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
  try {
    const cmd = makeReportCommand();
    cmd.exitOverride();
    await cmd.parseAsync(['node', 'report', ...args]);
  } catch (e: unknown) {
    if (e instanceof Error && e.message !== 'exit') throw e;
  }
  return { out, err };
}

const usageFixture = {
  summary: {
    totalCost: 0.001234,
    totalCalls: 5,
    successCalls: 4,
    errorCalls: 1,
    completionCalls: 3,
    completionCost: 0.001,
    routingCalls: 1,
    routingCost: 0.0002,
    guardrailCalls: 1,
    guardrailCost: 0.0000034,
  },
  byModel: {
    'gpt-4o': { calls: 3, inputTokens: 1000, outputTokens: 500, cost: 0.001, errors: 1 },
    'gpt-4o-mini': { calls: 2, inputTokens: 500, outputTokens: 250, cost: 0.0002, errors: 0 },
  },
  records: [
    { timestamp: '2026-01-01T00:00:00Z', projectId: 'proj-abc', modelId: 'gpt-4o', inputTokens: 100, outputTokens: 50, cost: 0.0005, latencyMs: 300, outcome: 'success' },
    { timestamp: '2026-01-01T00:01:00Z', projectId: 'proj-abc', modelId: 'gpt-4o', inputTokens: 200, outputTokens: 100, cost: 0.001, latencyMs: 500, outcome: 'error' },
  ],
};

// ── report usage ─────────────────────────────────────────────────────────────

describe('report usage', () => {
  it('prints usage table with model breakdown', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('usage');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('/api/usage'));
    expect(out.join('\n')).toMatch(/gpt-4o/);
  });

  it('shows call type breakdown when present', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('usage');
    expect(out.join('\n')).toContain('completion');
    expect(out.join('\n')).toContain('routing');
    expect(out.join('\n')).toContain('guardrail');
  });

  it('appends --type filter as requestType', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--type', 'rerank');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('requestType=rerank'));
  });

  it('rejects an unknown --type before calling the API', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { err } = await run('usage', '--type', 'garbage');
    expect(err.join('\n')).toContain("unknown type 'garbage'");
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('prints "no records" when totalCalls is 0', async () => {
    mockApi.mockResolvedValue({ ...usageFixture, summary: { ...usageFixture.summary, totalCalls: 0 } });
    const { out } = await run('usage');
    expect(out.join('\n')).toContain('No usage records');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('usage', '--json');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed).toHaveProperty('summary');
  });

  it('appends --project filter to URL', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--project', 'my-proj');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('projectId=my-proj'));
  });

  it('appends --session-id filter to URL', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--session-id', 'sess-1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('sessionId=sess-1'));
  });

  it('appends --end-user filter to URL', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--end-user', 'user-1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('endUserId=user-1'));
  });

  it('appends --tag filter to URL', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--tag', 'env=prod');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('tag%5Benv%5D=prod'));
  });

  it('ignores --tag without a value part', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--tag', 'noequals');
    // Should not crash; tag not added to params
    expect(mockApi).toHaveBeenCalled();
  });

  it('highlights error count in red', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('usage');
    // gpt-4o has 1 error — should appear somewhere
    expect(out.join('\n')).toMatch(/1/);
  });

  it('does not show breakdown when optional fields absent', async () => {
    // No completionCalls/routingCalls/guardrailCalls
    const minimal = {
      summary: { totalCost: 0.01, totalCalls: 2, successCalls: 2, errorCalls: 0 },
      byModel: { 'gpt-4o': { calls: 2, inputTokens: 100, outputTokens: 50, cost: 0.01, errors: 0 } },
      records: [],
    };
    mockApi.mockResolvedValue(minimal);
    const { out } = await run('usage');
    // Should not throw; no breakdown line
    expect(out.join('\n')).not.toContain('Breakdown');
  });

  it('shows breakdown with null cost fields using 0 fallback', async () => {
    const withNullCost = {
      ...usageFixture,
      summary: {
        ...usageFixture.summary,
        completionCalls: 1, completionCost: undefined,  // undefined → ?? 0
        routingCalls: 1, routingCost: undefined,
        guardrailCalls: 1, guardrailCost: undefined,
      },
    };
    mockApi.mockResolvedValue(withNullCost);
    const { out } = await run('usage');
    expect(out.join('\n')).toContain('Breakdown');
  });

  it('surfaces blocked calls in the human summary and breakdown (#77)', async () => {
    const withBlocked = {
      ...usageFixture,
      summary: { ...usageFixture.summary, blockedCalls: 2 },
    };
    mockApi.mockResolvedValue(withBlocked);
    const { out } = await run('usage');
    const text = out.join('\n');
    // summary line mentions blocked count
    expect(text).toMatch(/2 blocked/);
    // breakdown line includes a blocked entry
    expect(text).toContain('blocked: 2 calls');
  });

  it('omits blocked from the summary when blockedCalls is 0 or absent', async () => {
    mockApi.mockResolvedValue(usageFixture); // no blockedCalls
    const { out } = await run('usage');
    const text = out.join('\n');
    expect(text).not.toContain('blocked');
  });

  it('--json payload includes guardrail and blocked summary stats (#77)', async () => {
    const withBlocked = {
      ...usageFixture,
      summary: { ...usageFixture.summary, blockedCalls: 2 },
    };
    mockApi.mockResolvedValue(withBlocked);
    const { out } = await run('usage', '--json');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.summary.guardrailCalls).toBe(1);
    expect(parsed.summary.guardrailCost).toBeCloseTo(0.0000034);
    expect(parsed.summary.blockedCalls).toBe(2);
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('Network error'));
    const { err } = await run('usage');
    expect(err.join('\n')).toContain('Network error');
  });
});

// ── report calls ─────────────────────────────────────────────────────────────

describe('report calls', () => {
  it('prints call records table', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('calls');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('/api/usage'));
    expect(out.join('\n')).toMatch(/gpt-4o/);
  });

  it('limits output to --limit rows', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...usageFixture.records[0],
      timestamp: `2026-01-01T${String(i).padStart(2, '0')}:00:00Z`,
    }));
    mockApi.mockResolvedValue({ ...usageFixture, records: many });
    await run('calls', '--limit', '5');
    // Should not throw; limit is applied
    expect(mockApi).toHaveBeenCalled();
  });

  it('colors success outcome green and error red', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('calls');
    expect(out.join('\n')).toMatch(/success|error/);
  });

  it('appends --project filter', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('calls', '--project', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('projectId=p1'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('fail'));
    const { err } = await run('calls');
    expect(err.join('\n')).toContain('fail');
  });

  it('appends --type filter as requestType', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('calls', '--type', 'embedding');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('requestType=embedding'));
  });

  it('rejects an unknown --type before calling the API', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { err } = await run('calls', '--type', 'garbage');
    expect(err.join('\n')).toContain("unknown type 'garbage'");
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('prints the request type column, defaulting legacy records to Chat', async () => {
    mockApi.mockResolvedValue({
      ...usageFixture,
      records: [
        { ...usageFixture.records[0], requestType: 'image' },
        usageFixture.records[1], // legacy: no requestType
      ],
    });
    const { out } = await run('calls');
    expect(out.join('\n')).toMatch(/Image/);
    expect(out.join('\n')).toMatch(/Chat/);
  });
});

// ── report leaderboard ───────────────────────────────────────────────────────

const leaderboardFixture = [
  { modelId: 'gpt-4o', provider: 'openai', totalRequests: 100, successRate: 0.98, avgLatencyMs: 320, avgCostPer1kTokens: 0.005, totalCost: 0.50 },
  { modelId: 'gpt-4o-mini', provider: 'openai', totalRequests: 200, successRate: 0.99, avgLatencyMs: 150, avgCostPer1kTokens: 0.00015, totalCost: 0.03 },
];

describe('report leaderboard', () => {
  it('prints leaderboard table', async () => {
    mockApi.mockResolvedValue(leaderboardFixture);
    const { out } = await run('leaderboard');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('/api/leaderboard'));
    expect(out.join('\n')).toContain('gpt-4o');
  });

  it('marks rank-1 with a star', async () => {
    mockApi.mockResolvedValue(leaderboardFixture);
    const { out } = await run('leaderboard');
    expect(out.join('\n')).toContain('★');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(leaderboardFixture);
    const { out } = await run('leaderboard', '--json');
    const parsed = JSON.parse(out.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('prints empty message when no data', async () => {
    mockApi.mockResolvedValue([]);
    const { out } = await run('leaderboard');
    expect(out.join('\n')).toContain('No leaderboard data');
  });

  it('appends --project filter', async () => {
    mockApi.mockResolvedValue(leaderboardFixture);
    await run('leaderboard', '--project', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('projectId=p1'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('boom'));
    const { err } = await run('leaderboard');
    expect(err.join('\n')).toContain('boom');
  });
});

// ── report sessions ──────────────────────────────────────────────────────────

const sessionsFixture = [
  { sessionId: 'sess-aabbccddeeff1122', projectId: 'proj-abc123456789', requests: 5, totalCost: 0.01, startedAt: '2026-01-01T00:00:00Z' },
];

describe('report sessions', () => {
  it('prints sessions table', async () => {
    mockApi.mockResolvedValue(sessionsFixture);
    const { out } = await run('sessions');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('/api/sessions'));
    expect(out.join('\n')).toMatch(/sess-/);
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(sessionsFixture);
    const { out } = await run('sessions', '--json');
    const parsed = JSON.parse(out.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('prints empty message when no data', async () => {
    mockApi.mockResolvedValue([]);
    const { out } = await run('sessions');
    expect(out.join('\n')).toContain('No sessions');
  });

  it('appends --project filter', async () => {
    mockApi.mockResolvedValue(sessionsFixture);
    await run('sessions', '--project', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('projectId=p1'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('fail'));
    const { err } = await run('sessions');
    expect(err.join('\n')).toContain('fail');
  });
});

// ── report end-users ─────────────────────────────────────────────────────────

const endUsersFixture = [
  { userId: 'user-111', requests: 10, totalCost: 0.05 },
  { userId: 'user-222', requests: 3, totalCost: 0.01 },
];

describe('report end-users', () => {
  it('prints end-users table', async () => {
    mockApi.mockResolvedValue(endUsersFixture);
    const { out } = await run('end-users');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('/api/end-users'));
    expect(out.join('\n')).toContain('user-111');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(endUsersFixture);
    const { out } = await run('end-users', '--json');
    const parsed = JSON.parse(out.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('prints empty message when no data', async () => {
    mockApi.mockResolvedValue([]);
    const { out } = await run('end-users');
    expect(out.join('\n')).toContain('No end-user data');
  });

  it('appends --project filter', async () => {
    mockApi.mockResolvedValue(endUsersFixture);
    await run('end-users', '--project', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('projectId=p1'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('fail'));
    const { err } = await run('end-users');
    expect(err.join('\n')).toContain('fail');
  });
});
