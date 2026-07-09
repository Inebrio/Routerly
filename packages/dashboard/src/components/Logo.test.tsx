import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders an SVG with default size', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('32');
    expect(svg!.getAttribute('height')).toBe('32');
  });

  it('renders with custom size', () => {
    const { container } = render(<Logo size={48} />);
    const svg = container.querySelector('svg');
    expect(svg!.getAttribute('width')).toBe('48');
    expect(svg!.getAttribute('height')).toBe('48');
  });

  it('applies className prop', () => {
    const { container } = render(<Logo className="my-logo" />);
    expect(container.querySelector('svg')!.classList.contains('my-logo')).toBe(true);
  });

  it('has aria-label', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Routerly.ai');
  });
});
