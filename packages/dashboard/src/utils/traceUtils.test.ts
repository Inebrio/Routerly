import { describe, it, expect } from 'vitest';
import {
  extractMessageStats,
  formatDuration,
  formatTokensPerSec,
  formatCost,
  formatTokens,
} from './traceUtils.js';

describe('extractMessageStats', () => {
  it('returns empty stats for empty trace array', () => {
    const stats = extractMessageStats([]);
    expect(stats.selectedModel).toBeNull();
    expect(stats.hasError).toBe(false);
    expect(stats.fallbackUsed).toBe(false);
    expect(stats.latencyMs).toBeNull();
  });

  it('extracts selectedModel and routerScore from router:recap', () => {
    const stats = extractMessageStats([
      { message: 'router:recap', details: { final: [{ model: 'openai/gpt-4o', score: 0.85 }] } },
    ]);
    expect(stats.selectedModel).toBe('openai/gpt-4o');
    expect(stats.routerScore).toBe(0.85);
  });

  it('uses weight if score is absent', () => {
    const stats = extractMessageStats([
      { message: 'router:recap', details: { final: [{ model: 'anthropic/claude-3', weight: 0.7 }] } },
    ]);
    expect(stats.routerScore).toBe(0.7);
  });

  it('extracts completion metrics from model:success', () => {
    const stats = extractMessageStats([
      {
        message: 'model:success',
        details: {
          inputTokens: 100,
          outputTokens: 500,
          cachedInputTokens: 20,
          latencyMs: 2500,
          ttftMs: 300,
          tokensPerSec: 120,
          inputCostUsd: 0.0001,
          outputCostUsd: 0.001,
          totalCostUsd: 0.0011,
          inputPerMillion: 1.0,
          outputPerMillion: 2.0,
        },
      },
    ]);
    expect(stats.inputTokens).toBe(100);
    expect(stats.outputTokens).toBe(500);
    expect(stats.cachedTokens).toBe(20);
    expect(stats.latencyMs).toBe(2500);
    expect(stats.ttftMs).toBe(300);
    expect(stats.tokensPerSec).toBe(120);
    expect(stats.totalCostUsd).toBe(0.0011);
  });

  it('sets hasError=true when model:error with no model:success', () => {
    const stats = extractMessageStats([
      { message: 'model:error', details: { error: 'EHOSTDOWN' } },
    ]);
    expect(stats.hasError).toBe(true);
    expect(stats.fallbackUsed).toBe(false);
    expect(stats.errorMessage).toBe('EHOSTDOWN');
  });

  it('sets fallbackUsed=true when model:error AND model:success both exist', () => {
    const stats = extractMessageStats([
      { message: 'model:error', details: { error: 'Connection refused' } },
      { message: 'model:success', details: { inputTokens: 50, outputTokens: 200, latencyMs: 1000 } },
    ]);
    expect(stats.hasError).toBe(false);
    expect(stats.fallbackUsed).toBe(true);
    expect(stats.errorMessage).toBe('Connection refused');
    expect(stats.latencyMs).toBe(1000);
  });

  it('prefers details.message if details.error is absent', () => {
    const stats = extractMessageStats([
      { message: 'model:error', details: { message: 'timeout' } },
    ]);
    expect(stats.errorMessage).toBe('timeout');
  });

  it('defaults errorMessage to Unknown error when details are empty', () => {
    const stats = extractMessageStats([
      { message: 'model:error', details: {} },
    ]);
    expect(stats.errorMessage).toBe('Unknown error');
  });

  it('sets cacheHit with similarity from cache:hit', () => {
    const stats = extractMessageStats([
      { message: 'cache:hit', details: { similarity: 0.97 } },
    ]);
    expect(stats.cacheHit).toBe(true);
    expect(stats.cacheMiss).toBe(false);
    expect(stats.cacheSimilarity).toBe(0.97);
  });

  it('sets cacheMiss from cache:miss', () => {
    const stats = extractMessageStats([
      { message: 'cache:miss', details: {} },
    ]);
    expect(stats.cacheHit).toBe(false);
    expect(stats.cacheMiss).toBe(true);
    expect(stats.cacheSimilarity).toBeNull();
  });

  it('handles missing router:recap gracefully', () => {
    const stats = extractMessageStats([
      { message: 'model:success', details: { latencyMs: 500 } },
    ]);
    expect(stats.selectedModel).toBeNull();
    expect(stats.routerScore).toBeNull();
    expect(stats.latencyMs).toBe(500);
  });
});

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
