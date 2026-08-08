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
});
