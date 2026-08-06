import { describe, it, expect } from 'vitest';
import { suggestConnectionLabel, isConnectionLabelTaken } from './config.js';

describe('suggestConnectionLabel', () => {
  it('names a connection after its provider when nothing is taken', () => {
    expect(suggestConnectionLabel('openai', undefined, [])).toBe('openai');
  });

  it('names a custom connection after the upstream it points at', () => {
    expect(suggestConnectionLabel('custom', 'DeepSeek', [])).toBe('deepseek');
  });

  it('counts up from 2 while the slug is taken', () => {
    expect(suggestConnectionLabel('openai', undefined, ['openai'])).toBe('openai-2');
    expect(suggestConnectionLabel('openai', undefined, ['openai', 'openai-2'])).toBe('openai-3');
  });

  it('reuses a hole left by a deleted connection', () => {
    expect(suggestConnectionLabel('openai', undefined, ['openai', 'openai-3'])).toBe('openai-2');
  });

  it('ignores case and surrounding space when checking what is taken', () => {
    expect(suggestConnectionLabel('openai', undefined, ['  OpenAI '])).toBe('openai-2');
  });

  it('slugifies punctuation and spaces out of the upstream name', () => {
    expect(suggestConnectionLabel('custom', 'Acme AI (EU)', [])).toBe('acme-ai-eu');
  });

  it('falls back to a generic name when the upstream slugifies to nothing', () => {
    expect(suggestConnectionLabel('custom', '???', [])).toBe('custom');
    expect(suggestConnectionLabel('!!!', '', [])).toBe('connection');
  });
});

describe('isConnectionLabelTaken', () => {
  it('matches ignoring case and surrounding space', () => {
    expect(isConnectionLabelTaken(' OpenAI ', ['openai'])).toBe(true);
    expect(isConnectionLabelTaken('openai', ['  OPENAI'])).toBe(true);
  });

  it('says no when nothing matches', () => {
    expect(isConnectionLabelTaken('openai', ['anthropic', 'openai-2'])).toBe(false);
    expect(isConnectionLabelTaken('openai', [])).toBe(false);
  });
});
