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
    { timestamp: '2026-01-01T00:00:00Z', routerId: 'proj-abc', modelId: 'gpt-4o', inputTokens: 100, outputTokens: 50, cost: 0.0005, latencyMs: 300, outcome: 'success' },
    { timestamp: '2026-01-01T00:01:00Z', routerId: 'proj-abc', modelId: 'gpt-4o', inputTokens: 200, outputTokens: 100, cost: 0.001, latencyMs: 500, outcome: 'error' },
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

  it('appends --caller filter as callType', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--caller', 'routing');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('callType=routing'));
  });

  it('rejects an unknown --caller before calling the API', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { err } = await run('usage', '--caller', 'garbage');
    expect(err.join('\n')).toContain("unknown caller 'garbage'");
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('appends --token filter as tokenIds', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--token', 'tok-1,tok-2');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('tokenIds=tok-1%2Ctok-2'));
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

  it('appends --router filter to URL', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('usage', '--router', 'my-proj');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('routerId=my-proj'));
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

  it('lists the request types the window holds, busiest first (T210)', async () => {
    mockApi.mockResolvedValue({ ...usageFixture, byRequestType: { chat: 4, embedding: 1 } });
    const { out } = await run('usage');
    expect(out.join('\n')).toContain('Types — Chat: 4  |  Embedding: 1');
  });

  it('prints no type line when the service ships no counts (T210)', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { out } = await run('usage');
    expect(out.join('\n')).not.toContain('Types —');
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

  it('appends --router filter', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('calls', '--router', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('routerId=p1'));
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

  it('appends --caller filter as callType', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('calls', '--caller', 'guardrail');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('callType=guardrail'));
  });

  it('rejects an unknown --caller before calling the API', async () => {
    mockApi.mockResolvedValue(usageFixture);
    const { err } = await run('calls', '--caller', 'garbage');
    expect(err.join('\n')).toContain("unknown caller 'garbage'");
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('appends --token filter as tokenIds', async () => {
    mockApi.mockResolvedValue(usageFixture);
    await run('calls', '--token', 'tok-1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('tokenIds=tok-1'));
  });

  it('prints the token column, dashed on records written before it was tracked', async () => {
    mockApi.mockResolvedValue({
      ...usageFixture,
      records: [
        { ...usageFixture.records[0], tokenId: '3f2b1c4d-9a8b-4c7d-8e6f-1a2b3c4d5e6f' },
        usageFixture.records[1], // legacy: no tokenId
      ],
    });
    const { out } = await run('calls');
    expect(out.join('\n')).toContain('3f2b1c4d');
    expect(out.join('\n')).toMatch(/-\s*\u2502/);
  });

  it('prints the caller column, defaulting legacy records to completion', async () => {
    mockApi.mockResolvedValue({
      ...usageFixture,
      records: [
        { ...usageFixture.records[0], callType: 'routing' },
        usageFixture.records[1], // legacy: no callType
      ],
    });
    const { out } = await run('calls');
    expect(out.join('\n')).toMatch(/routing/);
    expect(out.join('\n')).toMatch(/completion/);
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

  it('appends --router filter', async () => {
    mockApi.mockResolvedValue(leaderboardFixture);
    await run('leaderboard', '--router', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('routerId=p1'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('boom'));
    const { err } = await run('leaderboard');
    expect(err.join('\n')).toContain('boom');
  });
});

// ── report sessions ──────────────────────────────────────────────────────────

const sessionsFixture = [
  { sessionId: 'sess-aabbccddeeff1122', routerId: 'proj-abc123456789', requests: 5, totalCost: 0.01, startedAt: '2026-01-01T00:00:00Z' },
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

  it('appends --router filter', async () => {
    mockApi.mockResolvedValue(sessionsFixture);
    await run('sessions', '--router', 'p1');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('routerId=p1'));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('fail'));
    const { err } = await run('sessions');
    expect(err.join('\n')).toContain('fail');
  });
});

// ── report savings (T64) ─────────────────────────────────────────────────────

const savingsFixture = {
  ...usageFixture,
  savings: {
    comparedCalls: 9,
    comparedCost: 0.003,
    comparedLatencyMs: 9000,
    comparedInputTokens: 1000,
    comparedOutputTokens: 500,
    cache: { inputTokens: 400, cost: 0.0009 },
    baselines: [
      { modelId: 'cheap', cost: 0.003, costDelta: 0, costDeltaPercent: 0, latencyMs: 8000, latencyDeltaMs: -1000, latencySamples: 8, tokensEstimated: 1500, tokenDelta: 0 },
      { modelId: 'expensive', cost: 0.03, costDelta: 0.027, costDeltaPercent: 90, latencySamples: 0, tokensEstimated: 1725, tokenDelta: 225 },
    ],
    optimizers: [
      { id: 'ccr', calls: 7, tokensSaved: 4200, costSaved: 0.0126, rolledBack: 0 },
      { id: 'caveman', calls: 2, tokensSaved: 130, costSaved: 0.0004, rolledBack: 3 },
    ],
  },
};

const seriesFixture = {
  bucket: 'day',
  baselineModelId: 'expensive',
  points: [
    { bucket: '2026-07-31', calls: 2, cost: 0.006, baselineCost: 0.06, inputTokens: 2000, outputTokens: 1000, cachedInputTokens: 0, latencyMs: 2000, baselineLatencyMs: 4000 },
    { bucket: '2026-08-01', calls: 1, cost: 0.003, baselineCost: 0, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, latencyMs: 1000, baselineLatencyMs: 0 },
  ],
};

describe('report savings', () => {
  it('asks the service for the savings block', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    await run('savings');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('savings=1'));
  });

  it('reports the actual traffic and what the cache already saved', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    const { out } = await run('savings');
    const text = out.join('\n');
    expect(text).toContain('Compared calls: 9');
    expect(text).toContain('$0.003000');
    expect(text).toContain('$0.000900 saved');
  });

  it('lists one counterfactual per target, priced and never timed', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    const { out } = await run('savings');
    const text = out.join('\n');
    expect(text).toContain('expensive');
    expect(text).toContain('$0.027000');
    expect(text).toContain('90.0%');
    // The time counterfactual was an estimate nobody could check: it is gone.
    expect(text).not.toContain('Would take');
    expect(text).not.toContain('Time saved');
  });

  it('anchors the saving on the costliest baseline, the cheapest as context', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    const { out } = await run('savings');
    const text = out.join('\n');
    expect(text).toContain('Cost saved:   $0.027000 (vs always expensive)');
    expect(text).toContain('              $0.000000 (vs always cheap)');
    expect(text).toContain('Tokens saved: 4,330 cut by optimizers, measured');
    expect(text).toContain('225 vs always expensive, estimated');
  });

  it('drops the summary when every baseline is free', async () => {
    const baselines = savingsFixture.savings.baselines.map(b => ({ ...b, cost: 0 }));
    mockApi.mockResolvedValue({ ...savingsFixture, savings: { ...savingsFixture.savings, baselines } });
    const { out } = await run('savings');
    expect(out.join('\n')).not.toContain('Cost saved:');
  });

  it('names each optimizer and counts its rollbacks', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    const { out } = await run('savings');
    const text = out.join('\n');
    expect(text).toContain('Conversation Context Reduction');
    expect(text).toContain('4,200');
    expect(text).toContain('Caveman');
  });

  it('stays quiet about optimizers when none touched a call', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, savings: { ...savingsFixture.savings, optimizers: [] } });
    const { out } = await run('savings');
    expect(out.join('\n')).not.toContain('What the optimizers removed');
  });

  it('says so when the router has no target model to compare against', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, savings: { ...savingsFixture.savings, baselines: [] } });
    const { out } = await run('savings');
    expect(out.join('\n')).toContain('No target model to compare against');
  });

  it('reports an empty period instead of a table of zeros', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, savings: { ...savingsFixture.savings, comparedCalls: 0 } });
    const { out } = await run('savings', '--period', 'daily');
    expect(out.join('\n')).toContain('No comparable calls for period: daily');
  });

  it('outputs the savings block alone with --json', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    const { out } = await run('savings', '--json');
    expect(JSON.parse(out.join('\n'))).toEqual(savingsFixture.savings);
  });

  it('asks for the series and breaks the saving down with --trend', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, series: seriesFixture });
    const { out } = await run('savings', '--trend');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('series=1'));
    const text = out.join('\n');
    expect(text).toContain('Per day');
    expect(text).toContain('against expensive');
    expect(text).toContain('2026-07-31');
    expect(text).toContain('$0.054000'); // 0.06 baseline - 0.006 actual
    expect(text).toContain('2,000 / 1,000');
    expect(text).toContain('1,000'); // 2000 ms over 2 calls
  });

  it('leaves the series out unless --trend is asked for', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, series: seriesFixture });
    const { out } = await run('savings');
    expect(mockApi).toHaveBeenCalledWith('GET', expect.not.stringContaining('series=1'));
    expect(out.join('\n')).not.toContain('Per day');
  });

  it('says so when --trend has no bucket to show', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, series: { bucket: 'day', points: [] } });
    const { out } = await run('savings', '--trend');
    expect(out.join('\n')).toContain('No traffic to break down');
  });

  it('adds the series next to the savings fields with --json --trend', async () => {
    mockApi.mockResolvedValue({ ...savingsFixture, series: seriesFixture });
    const { out } = await run('savings', '--json', '--trend');
    expect(JSON.parse(out.join('\n'))).toEqual({ ...savingsFixture.savings, series: seriesFixture });
  });

  it('passes --router and --type through as filters', async () => {
    mockApi.mockResolvedValue(savingsFixture);
    await run('savings', '--router', 'p1', '--type', 'embedding');
    const url = String(mockApi.mock.calls[0]![1]);
    expect(url).toContain('routerId=p1');
    expect(url).toContain('requestType=embedding');
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('forbidden'));
    const { err } = await run('savings');
    expect(err.join('\n')).toContain('forbidden');
  });
});
