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

function candidate(routerId: string, weight: number): OrchestratorCandidateRef {
  return { routerId, weight };
}

describe('scoreOrchestratorCandidates', () => {
  it('never throws on an empty candidate pool', async () => {
    mockReadConfig.mockResolvedValue([]);
    await expect(scoreOrchestratorCandidates('orc-1', [], [])).resolves.toEqual([]);
  });

  it('bypasses scoring for a single candidate (no usage read needed)', async () => {
    const candidates = [candidate('r1', 1)];
    const result = await scoreOrchestratorCandidates('orc-1', candidates, [router('r1')]);
    expect(result).toEqual(candidates);
    expect(mockReadConfig).not.toHaveBeenCalled();
  });

  it('orders a router-kind-only candidate pool deterministically by weight, no usage history (AC8)', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1', 1), candidate('r2', 5), candidate('r3', 3)];
    const liveRouters = [router('r1'), router('r2'), router('r3')];
    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(result.map(c => c.routerId)).toEqual(['r2', 'r3', 'r1']);
  });

  it('produces the same deterministic order on repeated calls', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1', 2), candidate('r2', 2), candidate('r3', 4)];
    const liveRouters = [router('r1'), router('r2'), router('r3')];
    const first = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    const second = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(first.map(c => c.routerId)).toEqual(second.map(c => c.routerId));
    // r1 and r2 tie on weight too -> routerId ascending is the final tiebreak
    expect(first.map(c => c.routerId)).toEqual(['r3', 'r1', 'r2']);
  });

  it('never wrongly excludes a valid router-kind candidate', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1', 1), candidate('r2', 2)];
    const liveRouters = [router('r1'), router('r2')];
    const result = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.routerId).sort()).toEqual(['r1', 'r2']);
  });

  it('silently excludes a candidate whose router id no longer exists (EC3, deleted router)', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1', 1), candidate('deleted-router', 99)];
    const liveRouters = [router('r1')];
    const resolved = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(resolved.map(c => c.routerId)).toEqual(['r1']);
  });

  it('silently excludes a candidate whose router id was repointed to another kind', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('r1', 1), candidate('orc-2', 99)];
    const liveRouters = [router('r1'), router('orc-2', 'orchestrator')];
    const resolved = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(resolved.map(c => c.routerId)).toEqual(['r1']);
  });

  it('returns an empty array, not a throw, when every candidate has been deleted', async () => {
    mockReadConfig.mockResolvedValue([]);
    const candidates = [candidate('gone-1', 1), candidate('gone-2', 2)];
    await expect(scoreOrchestratorCandidates('orc-1', candidates, [])).resolves.toEqual([]);
  });

  it("reads the Orchestrator's own policies array, same as a plain Router's health/rate-limit/fairness policies", async () => {
    const now = Date.now();
    // r1 has recent errors that would tank its health score under default config.
    mockReadConfig.mockResolvedValue([
      { orchestratorId: 'orc-1', routerId: 'r1', outcome: 'error', timestamp: new Date(now - 1000).toISOString() },
      { orchestratorId: 'orc-1', routerId: 'r1', outcome: 'error', timestamp: new Date(now - 2000).toISOString() },
    ]);
    const candidates = [candidate('r1', 5), candidate('r2', 1)];
    const liveRouters = [router('r1'), router('r2')];

    // Default (no policies configured): r1's error history should demote it below r2 despite the higher weight.
    const withDefaultHealth = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters);
    expect(withDefaultHealth.map(c => c.routerId)).toEqual(['r2', 'r1']);

    // health/rate-limit/fairness explicitly disabled on the Orchestrator: falls back to weight only.
    const allDisabled = await scoreOrchestratorCandidates('orc-1', candidates, liveRouters, [
      { type: 'health', enabled: false },
      { type: 'rate-limit', enabled: false },
      { type: 'fairness', enabled: false },
    ]);
    expect(allDisabled.map(c => c.routerId)).toEqual(['r1', 'r2']);
  });
});
