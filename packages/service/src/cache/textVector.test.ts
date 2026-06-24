import { describe, it, expect } from 'vitest';
import { textToVector } from './textVector.js';

describe('textToVector', () => {
  it('same text → same vector', () => {
    const a = textToVector('hello world');
    const b = textToVector('hello world');
    expect(a).toEqual(b);
  });

  it('different text → different vectors (distinct bucket content)', () => {
    const a = textToVector('hello world');
    const b = textToVector('goodbye moon');
    // Different words → different bucket counts → different vectors
    expect(a).not.toEqual(b);
  });

  it('returns unit vector (magnitude ~1.0)', () => {
    const v = textToVector('the quick brown fox jumps over the lazy dog');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('returns empty array for empty/short-only text', () => {
    expect(textToVector('')).toEqual([]);
    expect(textToVector('a b c')).toEqual([]); // all < 2 chars
  });

  it('returns a fixed-dimension vector (512)', () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const v = textToVector(words);
    expect(v.length).toBe(512);
  });
});
