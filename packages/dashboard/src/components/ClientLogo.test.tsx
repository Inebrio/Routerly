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

  it('falls back to a monogram for a client with no published mark', () => {
    const { container } = render(<ClientLogo id="openclaw" label="OpenClaw" />);
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('text')!.textContent).toBe('OW');
  });

  it('shrinks a three-character monogram to keep it inside the tile', () => {
    const { container } = render(<ClientLogo id="generic-openai" label="Any OpenAI SDK app" />);
    const text = container.querySelector('text')!;
    expect(text.textContent).toBe('API');
    expect(text.getAttribute('font-size')).toBe('30');
  });

  it('renders a neutral question mark for an unknown client id', () => {
    const { container } = render(<ClientLogo id="nope" label="Nope" size={20} />);
    expect(container.querySelector('text')!.textContent).toBe('?');
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('20');
  });
});
