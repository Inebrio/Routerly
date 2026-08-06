import { describe, it, expect, vi } from 'vitest';
import { escapeLabel, renderLabels, renderMetric, percentile, aggregate } from './metrics-snapshot.js';

const { mockReadConfig, mockGetLimitUsageSnapshot } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockGetLimitUsageSnapshot: vi.fn(),
}));

vi.mock('../../modules/config/loader.js', () => ({ readConfig: mockReadConfig }));
vi.mock('../../modules/budget/budget.js', () => ({ getLimitUsageSnapshot: mockGetLimitUsageSnapshot }));

import { getMetricsSnapshot, routerBudgetRatio } from './metrics-snapshot.js';
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js';
import type { ModelConfig, RouterConfig } from '@routerly/shared';

describe('getMetricsSnapshot', () => {
  it('returns agg, routerName, modelInfo, routers, models', async () => {
    const usage = [
      {
        routerId: 'proj1',
        modelId: 'model1',
        outcome: 'success',
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        cost: 0.001,
        latencyMs: 100,
      },
    ];
    const routers = [{ id: 'proj1', name: 'My Router' }];
    const models: ModelConfig[] = [{ id: 'model1', name: 'model1', provider: 'openai', cost: { inputPerMillion: 0, outputPerMillion: 0 } }];
    const { instances, connections } = splitModelsIntoInstancesConnections(models);

    mockReadConfig
      .mockResolvedValueOnce(usage)       // usage
      .mockResolvedValueOnce(routers)    // routers
      .mockResolvedValueOnce(connections) // connections (listEffectiveModelsIncludingDisabled)
      .mockResolvedValueOnce(instances);  // instances

    const snap = await getMetricsSnapshot();

    expect(snap.routers).toEqual(routers);
    expect(snap.models).toHaveLength(1);
    expect(snap.models[0]).toMatchObject({ id: 'model1', provider: 'openai' });
    expect(snap.routerName('proj1')).toBe('My Router');
    expect(snap.routerName('unknown')).toBe('unknown');
    expect(snap.modelInfo('model1')).toEqual({ model: 'model1', provider: 'openai' });
    expect(snap.modelInfo('unknown')).toEqual({ model: 'unknown', provider: 'unknown' });
    expect(snap.agg.requests.size).toBeGreaterThan(0);
    expect(snap.agg.tokens.size).toBeGreaterThan(0);
    expect(snap.agg.cost.size).toBeGreaterThan(0);
    expect(snap.agg.durations.size).toBeGreaterThan(0);
  });

  it('handles cachedInputTokens when present', async () => {
    const usage = [
      {
        routerId: 'p',
        modelId: 'm',
        outcome: 'success',
        inputTokens: 8,
        outputTokens: 4,
        cachedInputTokens: 2,
        cost: 0.001,
        latencyMs: 50,
      },
    ];
    mockReadConfig
      .mockResolvedValueOnce(usage)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // connections
      .mockResolvedValueOnce([]); // instances

    const snap = await getMetricsSnapshot();
    // cached token bump should add a 'cached' type entry
    const tokenKeys = [...snap.agg.tokens.values()].map((e) => e.labels['type']);
    expect(tokenKeys).toContain('cached');
  });
});

describe('routerBudgetRatio', () => {
  it('returns 0 when router has no models', async () => {
    const router = { id: 'p', name: 'P', models: [] } as unknown as RouterConfig;
    const ratio = await routerBudgetRatio(router, []);
    expect(ratio).toBe(0);
  });

  it('returns max ratio across model limits', async () => {
    const router = {
      id: 'p',
      name: 'P',
      models: [{ modelId: 'm1' }],
    } as unknown as RouterConfig;
    const models = [{ id: 'm1', provider: 'openai' }] as unknown as ModelConfig[];

    mockGetLimitUsageSnapshot.mockResolvedValue([
      { metric: 'cost', value: 10, current: 7 },
      { metric: 'requests', value: 100, current: 50 },
    ]);

    const ratio = await routerBudgetRatio(router, models);
    expect(ratio).toBeCloseTo(0.7);
  });

  it('skips model refs where model is not found', async () => {
    const router = {
      id: 'p',
      name: 'P',
      models: [{ modelId: 'missing' }],
    } as unknown as RouterConfig;

    const ratio = await routerBudgetRatio(router, []);
    expect(ratio).toBe(0);
  });

  it('clamps ratio to 1 when over budget', async () => {
    const router = {
      id: 'p',
      name: 'P',
      models: [{ modelId: 'm1' }],
    } as unknown as RouterConfig;
    const models = [{ id: 'm1', provider: 'openai' }] as unknown as ModelConfig[];

    mockGetLimitUsageSnapshot.mockResolvedValue([{ metric: 'cost', value: 5, current: 10 }]);

    const ratio = await routerBudgetRatio(router, models);
    expect(ratio).toBe(1);
  });

  it('skips snapshot where value is 0 (line 109 branch)', async () => {
    const router = {
      id: 'p',
      name: 'P',
      models: [{ modelId: 'm1' }],
    } as unknown as RouterConfig;
    const models = [{ id: 'm1', provider: 'openai' }] as unknown as ModelConfig[];

    mockGetLimitUsageSnapshot.mockResolvedValue([{ metric: 'cost', value: 0, current: 0 }]);

    const ratio = await routerBudgetRatio(router, models);
    expect(ratio).toBe(0);
  });
});

describe('escapeLabel and renderLabels helpers', () => {
  it('escapeLabel escapes backslash, newline, and double-quote', () => {
    expect(escapeLabel('a\\b')).toBe('a\\\\b');
    expect(escapeLabel('a\nb')).toBe('a\\nb');
    expect(escapeLabel('a"b')).toBe('a\\"b');
    expect(escapeLabel('plain')).toBe('plain');
  });

  it('renderLabels returns empty string for empty labels', () => {
    expect(renderLabels({})).toBe('');
  });

  it('renderLabels formats labels correctly', () => {
    expect(renderLabels({ router: 'P', model: 'M' })).toMatch(/^\{router="P",model="M"\}$/);
  });

  it('renderMetric outputs HELP, TYPE, and sample lines', () => {
    const out = renderMetric({ name: 'foo_total', help: 'Foo', type: 'counter', samples: [{ labels: { router: 'P' }, value: 5 }] });
    expect(out).toContain('# HELP foo_total Foo');
    expect(out).toContain('# TYPE foo_total counter');
    expect(out).toContain('foo_total{router="P"} 5');
  });
});

describe('aggregate', () => {
  it('builds request, token, cost, and duration maps from usage records', () => {
    const records = [
      { routerId: 'p1', modelId: 'm1', outcome: 'success', inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, cost: 0.001, latencyMs: 100 },
      { routerId: 'p1', modelId: 'm1', outcome: 'success', inputTokens: 8, outputTokens: 4, cachedInputTokens: 0, cost: 0.0008, latencyMs: 80 },
    ];
    const agg = aggregate(records as any, (id) => id, (id) => ({ model: id, provider: 'openai' }));
    expect(agg.requests.size).toBe(1); // same label combo → merged
    expect([...agg.requests.values()][0]!.value).toBe(2);
    expect(agg.tokens.size).toBeGreaterThan(0);
    expect(agg.cost.size).toBe(1);
    expect(agg.durations.size).toBe(1);
  });

  it('percentile returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('evicts oldest latency when DURATION_WINDOW is exceeded (line 91 true branch)', () => {
    // 101 records for same router:model pair → d.latencies.length > 100 → shift()
    const records = Array.from({ length: 101 }, (_, i) => ({
      routerId: 'p1', modelId: 'm1', outcome: 'success',
      inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cost: 0.001, latencyMs: i + 1,
    }));
    const agg = aggregate(records as any, (id) => id, (id) => ({ model: id, provider: 'openai' }));
    const dur = [...agg.durations.values()][0]!;
    // After 101 pushes and 1 shift, exactly 100 latencies remain
    expect(dur.latencies.length).toBe(100);
  });
});

describe('routerBudgetRatio — ratio not updated (line 109 false branch)', () => {
  it('does not update maxRatio when new ratio is lower', async () => {
    const router = {
      id: 'p', name: 'P',
      models: [{ modelId: 'm1' }],
    } as unknown as import('@routerly/shared').RouterConfig;
    const models = [{ id: 'm1', provider: 'openai' }] as unknown as import('@routerly/shared').ModelConfig[];

    // Two snapshots: first gives 0.9, second gives 0.5 → maxRatio stays 0.9
    mockGetLimitUsageSnapshot.mockResolvedValue([
      { metric: 'cost', value: 10, current: 9 },  // ratio = 0.9
      { metric: 'cost', value: 10, current: 5 },  // ratio = 0.5 → not > maxRatio
    ]);

    const ratio = await routerBudgetRatio(router, models);
    expect(ratio).toBeCloseTo(0.9); // maxRatio = 0.9 (second snapshot didn't update it)
  });
});

// ─── renderLabels with undefined label value (line 14 ?? '') ─────────────────

describe('renderLabels — undefined label value (line 14 ?? "")', () => {
  it('uses empty string when label value is undefined (line 14 ?? "" branch=1)', () => {
    // TypeScript may prevent this but at runtime undefined can occur
    const labels: Record<string, string> = { router: undefined as any }
    const result = renderLabels(labels)
    expect(result).toBe('{router=""}')
  })
})

// ─── percentile — empty values returns 0 (line 43 ?? 0 branch) ──────────────

describe('percentile edge cases (line 43 ?? 0)', () => {
  it('returns 0 for empty array (line 41 early return)', () => {
    expect(percentile([], 95)).toBe(0)
  })
})
