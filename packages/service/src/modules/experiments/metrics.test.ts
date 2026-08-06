import { describe, it, expect } from 'vitest';
import type { ExperimentConfig, ProjectConfig, UsageRecord } from '@routerly/shared';
import { computeExperimentMetrics } from './metrics.js';

/** `undefined` is allowed per field so a test can drop one from the fixture. */
function experiment(over: { [K in keyof ExperimentConfig]?: ExperimentConfig[K] | undefined } = {}): ExperimentConfig {
  return {
    id: 'exp-1',
    name: 'Prompt A vs B',
    rotation: 'round-robin',
    variants: [
      { id: 'v-a', projectId: 'proj-a' },
      { id: 'v-b', projectId: 'proj-b', name: 'Cheap arm' },
    ],
    tokens: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as ExperimentConfig;
}

let seq = 0;
function record(over: { [K in keyof UsageRecord]?: UsageRecord[K] | undefined } = {}): UsageRecord {
  seq += 1;
  return {
    id: `u-${seq}`,
    timestamp: '2026-08-01T10:00:00.000Z',
    projectId: 'proj-a',
    modelId: 'm1',
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.01,
    latencyMs: 200,
    outcome: 'success',
    experimentId: 'exp-1',
    experimentVariantId: 'v-a',
    ...over,
  } as UsageRecord;
}

describe('computeExperimentMetrics', () => {
  it('returns a zeroed row for a variant that never ran', () => {
    const m = computeExperimentMetrics(experiment(), []);
    expect(m.totalCalls).toBe(0);
    expect(m.variants).toHaveLength(2);
    expect(m.variants[0]).toMatchObject({
      variantId: 'v-a', calls: 0, errors: 0, errorRate: 0, cost: 0,
      avgCostPerCall: 0, avgLatencyMs: 0, p95LatencyMs: 0, judgedCalls: 0, enoughSamples: false,
    });
    expect(m.variants[0]).not.toHaveProperty('avgScore');
    expect(m.variants[0]).not.toHaveProperty('avgTtftMs');
    expect(m.ready).toBe(false);
  });

  it('counts only the records this experiment routed', () => {
    const m = computeExperimentMetrics(experiment(), [
      record(),
      record({ experimentId: 'exp-other', experimentVariantId: 'v-a' }),
      record({ experimentId: undefined, experimentVariantId: undefined }),
    ]);
    expect(m.totalCalls).toBe(1);
    expect(m.variants[0]!.calls).toBe(1);
  });

  it('splits the records per variant', () => {
    const m = computeExperimentMetrics(experiment(), [
      record(),
      record(),
      record({ experimentVariantId: 'v-b', projectId: 'proj-b', cost: 0.002 }),
    ]);
    expect(m.variants[0]!.calls).toBe(2);
    expect(m.variants[1]!.calls).toBe(1);
    expect(m.variants[0]!.cost).toBeCloseTo(0.02, 6);
    expect(m.variants[1]!.cost).toBeCloseTo(0.002, 6);
    expect(m.variants[0]!.avgCostPerCall).toBeCloseTo(0.01, 6);
  });

  it('excludes the gateway overhead calls from the comparison', () => {
    const m = computeExperimentMetrics(experiment(), [
      record(),
      record({ callType: 'routing', cost: 1 }),
      record({ callType: 'guardrail', cost: 1 }),
      record({ callType: 'judge', cost: 1 }),
    ]);
    expect(m.variants[0]!.calls).toBe(1);
    expect(m.variants[0]!.cost).toBeCloseTo(0.01, 6);
  });

  it('keeps records that predate callType', () => {
    const m = computeExperimentMetrics(experiment(), [record({ callType: undefined })]);
    expect(m.variants[0]!.calls).toBe(1);
  });

  it('counts errors but not guardrail blocks', () => {
    const m = computeExperimentMetrics(experiment(), [
      record(),
      record({ outcome: 'error' }),
      record({ outcome: 'timeout' }),
      record({ outcome: 'blocked' }),
    ]);
    expect(m.variants[0]!.calls).toBe(4);
    expect(m.variants[0]!.errors).toBe(2);
    expect(m.variants[0]!.errorRate).toBeCloseTo(0.5, 6);
  });

  it('sums the tokens and averages the latency', () => {
    const m = computeExperimentMetrics(experiment(), [
      record({ latencyMs: 100 }),
      record({ latencyMs: 300, inputTokens: 200, outputTokens: 10 }),
    ]);
    expect(m.variants[0]!.inputTokens).toBe(300);
    expect(m.variants[0]!.outputTokens).toBe(60);
    expect(m.variants[0]!.avgLatencyMs).toBe(200);
  });

  it('reports p95 latency off the slow tail', () => {
    const records = Array.from({ length: 20 }, (_, i) => record({ latencyMs: (i + 1) * 100 }));
    const m = computeExperimentMetrics(experiment(), records);
    expect(m.variants[0]!.p95LatencyMs).toBe(1900);
  });

  it('averages ttft over the streamed calls only', () => {
    const m = computeExperimentMetrics(experiment(), [
      record({ ttftMs: 100 }),
      record({ ttftMs: 300 }),
      record(),
    ]);
    expect(m.variants[0]!.avgTtftMs).toBe(200);
  });

  it('turns the judge tally into an average', () => {
    const m = computeExperimentMetrics(
      experiment({ judgeScores: { 'v-a': { count: 4, totalScore: 30, lastAt: '2026-08-01T11:00:00.000Z' } } }),
      [record()],
    );
    expect(m.variants[0]!.judgedCalls).toBe(4);
    expect(m.variants[0]!.avgScore).toBeCloseTo(7.5, 6);
    expect(m.variants[1]!.judgedCalls).toBe(0);
    expect(m.variants[1]).not.toHaveProperty('avgScore');
  });

  it('ignores an empty tally rather than dividing by zero', () => {
    const m = computeExperimentMetrics(
      experiment({ judgeScores: { 'v-a': { count: 0, totalScore: 0, lastAt: '2026-08-01T11:00:00.000Z' } } }),
      [record()],
    );
    expect(m.variants[0]).not.toHaveProperty('avgScore');
  });

  it('names the variant, falling back to its project name', () => {
    const projects: ProjectConfig[] = [
      { id: 'proj-a', name: 'Baseline', tokens: [], members: [], models: [] },
      { id: 'proj-b', name: 'Challenger', tokens: [], members: [], models: [] },
    ];
    const m = computeExperimentMetrics(experiment(), [], projects);
    expect(m.variants[0]!.name).toBe('Baseline');
    expect(m.variants[1]!.name).toBe('Cheap arm');
  });

  it('leaves the name off when neither the variant nor a project supplies one', () => {
    const m = computeExperimentMetrics(experiment({ variants: [{ id: 'v-a', projectId: 'gone' }] }), []);
    expect(m.variants[0]).not.toHaveProperty('name');
  });

  it('is ready only when every variant reached the sample floor', () => {
    const exp = experiment({ minSamplesPerVariant: 2 });
    const partial = computeExperimentMetrics(exp, [record(), record()]);
    expect(partial.variants[0]!.enoughSamples).toBe(true);
    expect(partial.variants[1]!.enoughSamples).toBe(false);
    expect(partial.ready).toBe(false);

    const full = computeExperimentMetrics(exp, [
      record(), record(),
      record({ experimentVariantId: 'v-b' }), record({ experimentVariantId: 'v-b' }),
    ]);
    expect(full.ready).toBe(true);
  });

  it('defaults the sample floor to the shared constant', () => {
    expect(computeExperimentMetrics(experiment(), []).minSamplesPerVariant).toBe(30);
  });

  it('is never ready without variants', () => {
    const m = computeExperimentMetrics(experiment({ variants: [] }), []);
    expect(m.variants).toEqual([]);
    expect(m.ready).toBe(false);
  });

  it('echoes the experiment id', () => {
    const m = computeExperimentMetrics(experiment(), []);
    expect(m.experimentId).toBe('exp-1');
  });
});
