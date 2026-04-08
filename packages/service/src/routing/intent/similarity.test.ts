import { describe, it, expect } from 'vitest';
import { cosineSimilarity, meanVector } from './similarity.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns 0.0 when one vector is zero', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0.0 when both vectors are zero', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('computes correct similarity for known vectors', () => {
    // [1,1] vs [1,0] → dot=1, |a|=√2, |b|=1 → 1/√2 ≈ 0.7071
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(0.7071, 4);
  });
});

describe('meanVector', () => {
  it('returns [] for empty input', () => {
    expect(meanVector([])).toEqual([]);
  });

  it('returns the vector itself for a single input', () => {
    expect(meanVector([[1, 2, 3]])).toEqual([1, 2, 3]);
  });

  it('computes the correct element-wise mean', () => {
    const result = meanVector([[1, 2], [3, 4]]);
    expect(result[0]).toBeCloseTo(2);
    expect(result[1]).toBeCloseTo(3);
  });
});
