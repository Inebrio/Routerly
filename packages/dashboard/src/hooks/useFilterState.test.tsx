import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFilterState } from './useFilterState';

beforeEach(() => localStorage.clear());

function Probe<T>({
  options,
  next,
}: {
  options: Parameters<typeof useFilterState<T>>[0];
  next: T;
}) {
  const [state, setState] = useFilterState<T>(options);
  return (
    <div>
      <div data-testid="value">{JSON.stringify(state)}</div>
      <button onClick={() => setState(next)}>set</button>
    </div>
  );
}

describe('useFilterState', () => {
  it('returns defaultValue when localStorage is empty (line 20 — no saved value)', () => {
    render(<Probe options={{ key: 'k1', defaultValue: 'hello' }} next="world" />);
    expect(screen.getByTestId('value').textContent).toBe('"hello"');
  });

  it('restores value from localStorage on mount', () => {
    localStorage.setItem('k2', JSON.stringify('stored'));
    render(<Probe options={{ key: 'k2', defaultValue: 'default' }} next="x" />);
    expect(screen.getByTestId('value').textContent).toBe('"stored"');
  });

  it('persists state to localStorage on change (line 40)', async () => {
    render(<Probe options={{ key: 'k3', defaultValue: 'init' }} next="updated" />);
    await userEvent.click(screen.getByText('set'));
    expect(localStorage.getItem('k3')).toBe('"updated"');
    expect(screen.getByTestId('value').textContent).toBe('"updated"');
  });

  it('falls back to defaultValue when deserialize throws (line 28-31)', () => {
    localStorage.setItem('k4', 'not-json{{}');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Probe options={{ key: 'k4', defaultValue: 42 }} next={99} />);
    expect(screen.getByTestId('value').textContent).toBe('42');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses custom deserialize function', () => {
    localStorage.setItem('k5', '5');
    render(
      <Probe
        options={{ key: 'k5', defaultValue: 0, deserialize: (v) => parseInt(v, 10) }}
        next={0}
      />
    );
    expect(screen.getByTestId('value').textContent).toBe('5');
  });

  it('uses custom serialize function', async () => {
    render(
      <Probe
        options={{ key: 'k6', defaultValue: 0, serialize: (v) => String(v) }}
        next={7}
      />
    );
    await userEvent.click(screen.getByText('set'));
    expect(localStorage.getItem('k6')).toBe('7');
  });

  it('warns when localStorage.setItem throws (line 40 catch)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Probe options={{ key: 'k8', defaultValue: 'x' }} next="y" />);
    // happy-dom uses its own storage object — spy on the instance, not the prototype
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await userEvent.click(screen.getByText('set'));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
