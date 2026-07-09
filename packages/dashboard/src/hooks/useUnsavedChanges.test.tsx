import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useUnsavedChanges, UnsavedChangesModal } from './useUnsavedChanges';

// useBlocker requires a data router (createMemoryRouter), not MemoryRouter.
function Probe({ isDirty }: { isDirty: boolean }) {
  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);
  return (
    <div>
      <div data-testid="blocked">{String(isBlocked)}</div>
      <button onClick={proceed}>proceed</button>
      <button onClick={reset}>reset</button>
    </div>
  );
}

function renderProbe(isDirty: boolean) {
  const router = createMemoryRouter([{ path: '/', element: <Probe isDirty={isDirty} /> }]);
  return render(<RouterProvider router={router} />);
}

describe('useUnsavedChanges', () => {
  it('isBlocked is false when not dirty', async () => {
    renderProbe(false);
    await screen.findByTestId('blocked');
    expect(screen.getByTestId('blocked').textContent).toBe('false');
  });

  it('isBlocked is false when dirty (no navigation attempted)', async () => {
    renderProbe(true);
    await screen.findByTestId('blocked');
    expect(screen.getByTestId('blocked').textContent).toBe('false');
  });

  it('proceed() and reset() are callable without throwing', async () => {
    renderProbe(true);
    await screen.findByTestId('blocked');
    // blocker.proceed/reset are undefined when not in blocked state —
    // the optional chaining (?.) ensures no throw
    await userEvent.click(screen.getByText('proceed'));
    await userEvent.click(screen.getByText('reset'));
    expect(screen.getByTestId('blocked').textContent).toBe('false');
  });

  it('adds beforeunload listener when dirty', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderProbe(true);
    await screen.findByTestId('blocked');
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    addSpy.mockRestore();
  });

  it('does not add beforeunload listener when not dirty', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderProbe(false);
    await screen.findByTestId('blocked');
    const calls = addSpy.mock.calls.filter(([evt]) => evt === 'beforeunload');
    expect(calls.length).toBe(0);
    addSpy.mockRestore();
  });

  it('beforeunload handler sets returnValue', async () => {
    renderProbe(true);
    await screen.findByTestId('blocked');
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event);
    expect(event.returnValue).toBe('');
  });
});

describe('UnsavedChangesModal', () => {
  it('renders title and buttons', () => {
    render(<UnsavedChangesModal onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Unsaved Changes')).toBeTruthy();
    expect(screen.getByText('Stay')).toBeTruthy();
    expect(screen.getByText('Leave anyway')).toBeTruthy();
  });

  it('calls onConfirm when "Leave anyway" clicked', async () => {
    const onConfirm = vi.fn();
    render(<UnsavedChangesModal onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByText('Leave anyway'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when "Stay" clicked', async () => {
    const onCancel = vi.fn();
    render(<UnsavedChangesModal onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('Stay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
