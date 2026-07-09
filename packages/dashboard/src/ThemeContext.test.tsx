import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './ThemeContext';

beforeEach(() => localStorage.clear());

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('auto')}>auto</button>
    </div>
  );
}

function renderProvider() {
  return render(<ThemeProvider><Probe /></ThemeProvider>);
}

describe('ThemeProvider — initial theme', () => {
  it('defaults to "auto" when localStorage is empty (line 30 fallback branch)', () => {
    // No stored value → stored is null → condition is falsy → returns 'auto'
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('auto');
  });

  it('restores "dark" from localStorage', () => {
    localStorage.setItem('lr-theme', 'dark');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('restores "light" from localStorage', () => {
    localStorage.setItem('lr-theme', 'light');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('falls back to "auto" for invalid stored value (line 30 right-side branch)', () => {
    // stored is non-null but not in valid list → condition false → returns 'auto'
    localStorage.setItem('lr-theme', 'invalid-theme');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('auto');
  });
});

describe('ThemeProvider — setTheme', () => {
  it('updates theme state', async () => {
    renderProvider();
    await userEvent.click(screen.getByText('dark'));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('persists theme to localStorage', async () => {
    renderProvider();
    await userEvent.click(screen.getByText('light'));
    expect(localStorage.getItem('lr-theme')).toBe('light');
  });

  it('applies "auto" by removing data-theme attribute', async () => {
    localStorage.setItem('lr-theme', 'dark');
    renderProvider();
    // currently dark → sets attribute
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await userEvent.click(screen.getByText('auto'));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('applies "dark" by setting data-theme attribute', async () => {
    renderProvider();
    await userEvent.click(screen.getByText('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies "light" by setting data-theme attribute', async () => {
    renderProvider();
    await userEvent.click(screen.getByText('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('useTheme — default context value', () => {
  it('provides default theme "auto" without provider', () => {
    function Bare() {
      const { theme } = useTheme();
      return <div data-testid="t">{theme}</div>;
    }
    render(<Bare />);
    expect(screen.getByTestId('t').textContent).toBe('auto');
  });
});
