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

  it('handles b shorter than a (b[i] is undefined → ?? 0)', () => {
    // a=[1,0,1], b=[1,0] → b[2] is undefined → dot=1+0+0=1, normA=2, normB=1 → 1/√2
    expect(cosineSimilarity([1, 0, 1], [1, 0])).toBeCloseTo(0.7071, 4);
  });

  it('handles a shorter than b (a[i] is undefined → ?? 0)', () => {
    // Iterates a.length=2 times, so a[i] is always defined, b[2] would require 3-elem
    // Actually since loop goes up to a.length, a[i] is always valid; but b[i] may be undefined
    expect(cosineSimilarity([1, 0], [1, 0, 1])).toBeCloseTo(1.0, 4);
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

  it('handles vectors shorter than dim (v[i] undefined → ?? 0)', () => {
    // dim = vectors[0].length = 3, second vector has only 2 elements → v[2] is undefined
    const result = meanVector([[1, 2, 4], [1, 2]]);
    expect(result[0]).toBeCloseTo(1);
    expect(result[2]).toBeCloseTo(2); // (4 + 0) / 2
  });

  it('sum[i] ?? 0 branch when sum has fewer elements than dim', () => {
    // This is exercised naturally in the loop above when sum is pre-filled
    const result = meanVector([[0, 0, 0], [0, 0, 0]]);
    expect(result).toEqual([0, 0, 0]);
  });

  it('vectors[0]?.length ?? 0 fallback: first vector is undefined — returns empty', () => {
    // Force dim to take the ?? 0 branch by casting to bypass the type check.
    // When the first element is undefined, dim becomes 0 and sum stays empty.
    const result = meanVector([undefined as unknown as number[]]);
    expect(result).toEqual([]);
  });
});

describe('cosineSimilarity — a[i] ?? 0 nullish branch (line 10)', () => {
  it('handles sparse arrays where a[i] is undefined', () => {
    // Create a sparse array: arr[0] = 1, arr[2] = 1, arr[1] is a hole (undefined)
    const sparse: number[] = [];
    sparse[0] = 1;
    sparse[2] = 1;
    // b is a normal dense array of the same apparent length
    const dense = [1, 0, 1];
    // a.length is 3, sparse[1] is undefined → ?? 0 branch is hit on line 10 & 11
    const sim = cosineSimilarity(sparse, dense);
    expect(sim).toBeCloseTo(1.0);
  });
});
