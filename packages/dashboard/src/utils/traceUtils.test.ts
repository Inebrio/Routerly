import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatTokensPerSec,
  formatCost,
  formatTokens,
} from './traceUtils.js';

describe('formatDuration', () => {
  it('returns — for null', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('formats milliseconds under 1s', () => {
    expect(formatDuration(450)).toBe('450ms');
  });

  it('formats milliseconds >= 1s as seconds', () => {
    expect(formatDuration(2540)).toBe('2.54s');
  });

  it('rounds ms to integer', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats a window total as minutes and hours', () => {
    expect(formatDuration(90_000)).toBe('1.5m');
    expect(formatDuration(71_419_770)).toBe('19.8h');
  });

  it('keeps the sign in front of the unit', () => {
    expect(formatDuration(-450)).toBe('-450ms');
    expect(formatDuration(-1_713_784)).toBe('-28.6m');
  });
});

describe('formatTokensPerSec', () => {
  it('returns — for null', () => {
    expect(formatTokensPerSec(null)).toBe('—');
  });

  it('formats tokens per second', () => {
    expect(formatTokensPerSec(85.7)).toBe('86 T/s');
  });
});

describe('formatCost', () => {
  it('returns — for null', () => {
    expect(formatCost(null)).toBe('—');
  });

  it('returns $0.000 for zero', () => {
    expect(formatCost(0)).toBe('$0.000');
  });

  it('returns <$0.000001 for very tiny values', () => {
    expect(formatCost(0.0000005)).toBe('<$0.000001');
  });

  it('formats small values with 8 decimal places', () => {
    expect(formatCost(0.00001234)).toBe('$0.00001234');
  });

  it('formats values < 0.01 with 8 decimal places', () => {
    expect(formatCost(0.0042)).toBe('$0.00420000');
  });

  it('formats values in [0.01, 1) with 4 decimal places', () => {
    expect(formatCost(0.0500)).toBe('$0.0500');
  });

  it('formats values >= $1 with 2 decimal places', () => {
    expect(formatCost(1.5)).toBe('$1.50');
  });
});

describe('formatTokens', () => {
  it('returns — for null', () => {
    expect(formatTokens(null)).toBe('—');
  });

  it('formats number with locale separators', () => {
    // Just check it returns a non-empty string for a valid count
    const result = formatTokens(1234);
    expect(result).toBeTruthy();
    expect(result).toContain('1');
  });
});
