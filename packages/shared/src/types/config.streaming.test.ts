import { describe, it, expect } from 'vitest';
import { blocksResponseStreaming } from './config.js';

describe('blocksResponseStreaming', () => {
  it('true for an enabled blocking rule judging the response', () => {
    expect(blocksResponseStreaming([{ block: true, target: 'response' }])).toBe(true);
    expect(blocksResponseStreaming([{ block: true, target: 'both', enabled: true }])).toBe(true);
  });
  it('false for disabled, non-blocking, request-only, inject-only rules or no rules', () => {
    expect(blocksResponseStreaming([{ block: true, target: 'response', enabled: false }])).toBe(false);
    expect(blocksResponseStreaming([{ block: false, target: 'response' }])).toBe(false);
    expect(blocksResponseStreaming([{ block: true, target: 'request' }])).toBe(false);
    expect(blocksResponseStreaming([{ block: true }])).toBe(false);
    expect(blocksResponseStreaming(undefined)).toBe(false);
  });
});
