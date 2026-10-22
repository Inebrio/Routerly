import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// jsdom does no layout: guard the CSS that keeps long stat values (ROUT-389) inside the card.
const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');

describe('stat card value sizing', () => {
  it('scales the value with the card width instead of clipping', () => {
    expect(css).toMatch(/\.stat-card\s*{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/\.stat-value\s*{[^}]*font-size:\s*min\(28px,\s*13cqw\)/);
  });
});
