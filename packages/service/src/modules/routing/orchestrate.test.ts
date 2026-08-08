import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
}));

import { scoreOrchestratorCandidates } from './orchestrate.js';
import { readConfig } from '../config/loader.js';
import type { OrchestratorCandidateRef, RouterConfig } from '@routerly/shared';

const mockReadConfig = vi.mocked(readConfig);

afterEach(() => { vi.clearAllMocks(); });

function router(id: string, kind?: RouterConfig['kind']): RouterConfig {
  return { id, name: id, tokens: [], members: [], models: [], ...(kind !== undefined ? { kind } : {}) };
}

function candidate(routerId: string): OrchestratorCandidateRef {
  return { routerId };
}

describe('scoreOrchestratorCandidates', () => {
  it('never throws on an empty candidate pool', async () => {
    mockReadConfig.mockResolvedValue([]);
    await expect(scoreOrchestratorCandidates('orc-1', [], [])).resolves.toEqual([]);
  });

  it('bypasses scoring for a single candidate (no usage read needed)', async () => {
    const candidates = [candidate('r1')];
    const result = await scoreOrchestratorCandidates('orc-1', candidates, [router('r1')]);
    expect(result).toEqual(candidates);
    expect(mockReadConfig).not.toHaveBeenCalled();
  });

  it('AC3: with no usage history every candidate ties on quality, so array position (priority) decides the order', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r2'), candidate('r3'), candidate('r1')];
    const liveRouters = [router('r1'), router('r2'), router('r3')];
    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(result.map(c => c.routerId)).toEqual(['r2', 'r3', 'r1']);
  });

  it('produces the same deterministic order on repeated calls', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r3'), candidate('r1'), candidate('r2')];
    const liveRouters = [router('r1'), router('r2'), router('r3')];
    const first = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    const second = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(first.map(c => c.routerId)).toEqual(second.map(c => c.routerId));
    // every candidate ties on quality -> input array order is the final tiebreak
    expect(first.map(c => c.routerId)).toEqual(['r3', 'r1', 'r2']);
  });

  it('never wrongly excludes a valid router-kind candidate', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1'), candidate('r2')];
    const liveRouters = [router('r1'), router('r2')];
    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.routerId).sort()).toEqual(['r1', 'r2']);
  });

  it('silently excludes a candidate whose router id no longer exists (EC3, deleted router)', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1'), candidate('deleted-router')];
    const liveRouters = [router('r1')];
    const resolved = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(resolved.map(c => c.routerId)).toEqual(['r1']);
  });

  it('silently excludes a candidate whose router id was repointed to another kind', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1'), candidate('orc-2')];
    const liveRouters = [router('r1'), router('orc-2', 'orchestrator')];
    const resolved = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(resolved.map(c => c.routerId)).toEqual(['r1']);
  });

  it('returns an empty array, not a throw, when every candidate has been deleted', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('gone-1'), candidate('gone-2')];
    await expect(scoreOrchestratorCandidates('orc-1', candidates, [])).resolves.toEqual([]);
  });

  it("reads the Orchestrator's own policies array, same as a plain Router's health/rate-limit/fairness policies", async () => {
    const now = Date.now();
    // r1 has recent errors that would tank its health score under default config.
    mockReadConfig.mockResolvedValue([
      { orchestratorId: 'orc-1', routerId: 'r1', outcome: 'error', timestamp: new Date(now - 1000).toISOString() },
      { orchestratorId: 'orc-1', routerId: 'r1', outcome: 'error', timestamp: new Date(now - 2000).toISOString() },
    ]);
    const candidates = [candidate('r1'), candidate('r2')];
    const liveRouters = [router('r1'), router('r2')];

    // Default (no policies configured): r1's error history should demote it below r2 despite being first in the array.
    const withDefaultHealth = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(withDefaultHealth.map(c => c.routerId)).toEqual(['r2', 'r1']);

    // health/rate-limit/fairness explicitly disabled on the Orchestrator: every candidate ties on
    // quality (1.0) -> falls back to array position, so r1 (listed first) wins (AC3).
    const allDisabled = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, [
      { type: 'health', enabled: false },
      { type: 'rate-limit', enabled: false },
      { type: 'fairness', enabled: false },
    ]);
    expect(allDisabled.map(c => c.routerId)).toEqual(['r1', 'r2']);
  });

  // Isolates health/rate-limit/fairness so only the signal under test drives the order.
  const onlyPerformance = [
    { type: 'health' as const, enabled: false },
    { type: 'rate-limit' as const, enabled: false },
    { type: 'fairness' as const, enabled: false },
  ];
  const onlyBudgetRemaining = [
    { type: 'health' as const, enabled: false },
    { type: 'rate-limit' as const, enabled: false },
    { type: 'fairness' as const, enabled: false },
    { type: 'performance' as const, enabled: false },
  ];

  it('AC4: ranks the candidate with lower Orchestrator-scoped average latency higher via performance', async () => {
    const now = Date.now();
    mockReadConfig.mockResolvedValue([
      // r1: fast (10ms). r2: slow (1000ms). Both success, both recent.
      { orchestratorId: 'orc-1', routerId: 'r1', outcome: 'success', latencyMs: 10, timestamp: new Date(now - 1000).toISOString() },
      { orchestratorId: 'orc-1', routerId: 'r2', outcome: 'success', latencyMs: 1000, timestamp: new Date(now - 1000).toISOString() },
    ]);
    const candidates = [candidate('r1'), candidate('r2')];
    const liveRouters = [router('r1'), router('r2')];

    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, onlyPerformance);
    expect(result.map(c => c.routerId)).toEqual(['r1', 'r2']);
  });

  it('AC5: ranks the candidate with more remaining headroom under its own configured limits higher via budget-remaining', async () => {
    const now = new Date().toISOString();
    // r1: 9/10 calls used this period (little headroom). r2: 1/10 used (lots of headroom).
    mockReadConfig.mockResolvedValue([
      ...Array.from({ length: 9 }, () => ({ orchestratorId: 'orc-1', routerId: 'r1', outcome: 'success', timestamp: now })),
      { orchestratorId: 'orc-1', routerId: 'r2', outcome: 'success', timestamp: now },
    ]);
    const limits = [{ metric: 'calls' as const, windowType: 'period' as const, period: 'daily' as const, value: 10 }];
    const candidates: OrchestratorCandidateRef[] = [
      { routerId: 'r1', limits },
      { routerId: 'r2', limits },
    ];
    const liveRouters = [router('r1'), router('r2')];

    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, onlyBudgetRemaining);
    expect(result.map(c => c.routerId)).toEqual(['r2', 'r1']);
  });

  it('AC6: a candidate with zero limits configured is neutral (1.0), not excluded or penalized versus a candidate with full headroom', async () => {
    mockReadConfig.mockResolvedValue([]); // no usage history at all (EC1)
    const candidates: OrchestratorCandidateRef[] = [
      { routerId: 'r1' }, // no `limits` at all
      { routerId: 'r2', limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 10 }] }, // configured but unused -> full headroom
    ];
    const liveRouters = [router('r1'), router('r2')];

    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, onlyBudgetRemaining);
    // Both score a neutral 1.0 on budget-remaining -> tie -> earlier position in the input array
    // wins, proving neither was excluded nor penalized for having no `limits` at all.
    expect(result.map(c => c.routerId)).toEqual(['r1', 'r2']);
  });

  it('EC1: zero usage history against a candidate leaves performance/budget-remaining neutral, no throw', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates: OrchestratorCandidateRef[] = [
      { routerId: 'r1', limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 10 }] },
      { routerId: 'r2' },
    ];
    const liveRouters = [router('r1'), router('r2')];

    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, [
      { type: 'health', enabled: false }, { type: 'rate-limit', enabled: false }, { type: 'fairness', enabled: false },
      { type: 'performance', enabled: true }, { type: 'budget-remaining', enabled: true },
    ]);
    // No history anywhere -> both signals neutral for both candidates -> tie -> position decides.
    expect(result.map(c => c.routerId)).toEqual(['r1', 'r2']);
  });

  it('EC2: a candidate whose target Router was deleted is excluded before performance/budget-remaining are ever computed, no crash', async () => {
    mockReadConfig.mockResolvedValue([
      { orchestratorId: 'orc-1', routerId: 'r1', outcome: 'success', latencyMs: 10, timestamp: new Date().toISOString() },
    ]);
    const candidates: OrchestratorCandidateRef[] = [
      { routerId: 'r1', limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 10 }] },
      { routerId: 'deleted-router', limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 1 }] },
    ];
    const liveRouters = [router('r1')]; // 'deleted-router' no longer resolves

    const resolved = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, [
      { type: 'performance', enabled: true }, { type: 'budget-remaining', enabled: true },
    ]);
    expect(resolved.map(c => c.routerId)).toEqual(['r1']);
  });
});
