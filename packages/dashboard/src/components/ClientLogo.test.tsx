import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { ClientLogo } from './ClientLogo';

describe('ClientLogo', () => {
  it('draws the official glyph of a known client on its brand tile', () => {
    const { container } = render(<ClientLogo id="zed" label="Zed" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Zed logo');
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#084ccf');
    expect(svg.querySelector('path')!.getAttribute('d')).toContain('M2.25 1.5a.75.75 0');
    expect(svg.querySelector('text')).toBeNull();
  });

  it('scales a glyph that is not 24x24 through its own nested viewport', () => {
    const { container } = render(<ClientLogo id="continue" label="Continue" />);
    const nested = container.querySelectorAll('svg')[1]!;
    expect(nested.getAttribute('viewBox')).toBe('0 0 26 24');
    expect(nested.getAttribute('width')).toBe('52');
    expect(container.querySelector('text')).toBeNull();
  });

  it('draws the OpenClaw mascot with the eyes filled in the tile colour', () => {
    const { container } = render(<ClientLogo id="openclaw" label="OpenClaw" />);
    const tile = container.querySelector('rect')!;
    const eyes = container.querySelectorAll('ellipse');
    expect(tile.getAttribute('fill')).toBe('#cc3333');
    // Body plus the two eyes; the eyes sit in a group filled with the tile colour.
    expect(eyes).toHaveLength(3);
    expect(eyes[1]!.parentElement!.getAttribute('fill')).toBe('#cc3333');
    expect(container.querySelector('text')).toBeNull();
  });

  it('falls back to a monogram for the generic SDK entries', () => {
    const { container } = render(<ClientLogo id="generic-openai" label="Any OpenAI SDK app" />);
    const text = container.querySelector('text')!;
    expect(text.textContent).toBe('API');
    // Three characters need the smaller size to stay inside the tile.
    expect(text.getAttribute('font-size')).toBe('30');
  });

  it('renders a neutral question mark for an unknown client id', () => {
    const { container } = render(<ClientLogo id="nope" label="Nope" size={20} />);
    expect(container.querySelector('text')!.textContent).toBe('?');
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('20');
  });
});
