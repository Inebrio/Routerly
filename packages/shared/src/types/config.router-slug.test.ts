import { describe, it, expect } from 'vitest';
import { suggestRouterSlug } from './config.js';

describe('suggestRouterSlug', () => {
  it('slugifies the name when nothing is taken', () => {
    expect(suggestRouterSlug('My OpenAI', [])).toBe('my-openai');
  });

  it('counts up from 2 while the slug is taken', () => {
    expect(suggestRouterSlug('My OpenAI', ['my-openai'])).toBe('my-openai-2');
    expect(suggestRouterSlug('My OpenAI', ['my-openai', 'my-openai-2'])).toBe('my-openai-3');
  });

  it('ignores case and surrounding space when checking what is taken', () => {
    expect(suggestRouterSlug('My OpenAI', ['  My-OpenAI '])).toBe('my-openai-2');
  });

  it('falls back to a generic name when the name slugifies to nothing', () => {
    expect(suggestRouterSlug('???', [])).toBe('router');
  });
});
