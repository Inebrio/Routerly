import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Banners in App.tsx use var(--info-*) / var(--warning-*) with light fallbacks:
// without a token in every theme block the dark theme shows the light fallback (ROUT-404).
const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');
const tokens = ['info', 'warning'].flatMap((k) => ['bg', 'border', 'text'].map((p) => `--${k}-${p}:`));

describe('banner colour tokens', () => {
  it('are defined in the dark, light and prefers-color-scheme blocks', () => {
    for (const t of tokens) expect(css.split(t).length - 1).toBe(3);
  });
});
