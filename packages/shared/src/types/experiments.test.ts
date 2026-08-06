import { describe, it, expect } from 'vitest';
import {
  EXPERIMENT_ROTATIONS,
  STICKY_KEYS,
  ROTATION_CATALOG,
  rotationLabel,
  rotationDescription,
  variantShares,
  DEFAULT_MIN_SAMPLES_PER_VARIANT,
  type ExperimentConfig,
  type ExperimentRotation,
  type ExperimentVariant,
} from './experiments.js';

describe('experiment types', () => {
  it('type-checks a full experiment literal', () => {
    const experiment: ExperimentConfig = {
      id: 'exp-1',
      name: 'Cheap vs strong',
      rotation: 'sticky',
      stickyKey: 'auto',
      variants: [
        { id: 'a', projectId: 'proj-1' },
        { id: 'b', projectId: 'proj-2', name: 'Strong', weight: 30 },
      ],
      tokens: [{ id: 't1', token: 'sk-rt-x', createdAt: '2026-08-01T00:00:00.000Z' }],
      judge: { enabled: true, modelId: 'gpt-4o', criteria: ['Answers the question'], sampleRate: 0.1 },
      minSamplesPerVariant: 50,
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    expect(experiment.variants).toHaveLength(2);
  });

  it('describes every rotation exactly once', () => {
    expect(Object.keys(ROTATION_CATALOG).sort()).toEqual([...EXPERIMENT_ROTATIONS].sort());
    for (const rotation of EXPERIMENT_ROTATIONS) {
      expect(rotationLabel(rotation)).toBeTruthy();
      expect(rotationDescription(rotation).length).toBeGreaterThan(20);
    }
  });

  it('keeps the three rotations and four sticky keys stable', () => {
    expect(EXPERIMENT_ROTATIONS).toEqual(['sticky', 'weighted', 'round-robin'] satisfies ExperimentRotation[]);
    expect(STICKY_KEYS).toEqual(['auto', 'end-user', 'conversation', 'client']);
    expect(DEFAULT_MIN_SAMPLES_PER_VARIANT).toBe(30);
  });
});

describe('variantShares', () => {
  const v = (id: string, weight?: number): ExperimentVariant =>
    weight === undefined ? { id, projectId: `p-${id}` } : { id, projectId: `p-${id}`, weight };

  it('splits evenly when no variant declares a weight', () => {
    expect(variantShares([v('a'), v('b'), v('c')])).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('normalises against the declared total, not against 100', () => {
    expect(variantShares([v('a', 1), v('b', 3)])).toEqual([0.25, 0.75]);
    expect(variantShares([v('a', 25), v('b', 75)])).toEqual([0.25, 0.75]);
  });

  it('gives an explicit zero weight no traffic', () => {
    expect(variantShares([v('a', 0), v('b', 10)])).toEqual([0, 1]);
  });

  it('falls back to an even split rather than dividing by zero', () => {
    expect(variantShares([v('a', 0), v('b', 0)])).toEqual([0.5, 0.5]);
  });

  it('returns nothing for no variants', () => {
    expect(variantShares([])).toEqual([]);
  });
});
