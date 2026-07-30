import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getResilience: vi.fn(),
  resetResilience: vi.fn(),
}));

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { ResiliencePage } from './ResiliencePage';
import { getResilience, resetResilience } from '../api';
import { useAuth } from '../AuthContext';

const mockGetResilience = vi.mocked(getResilience as () => Promise<unknown>);
const mockResetResilience = vi.mocked(resetResilience as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    key: { level: 'provider', id: 'openai' },
    state: 'closed',
    failureCount: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ResiliencePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetResilience.mockResolvedValue({ entries: [], generatedAt: Date.now() });
  mockResetResilience.mockResolvedValue({ ok: true });
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'admin@test.com', role: 'admin' },
    isLoading: false,
    login: vi.fn(),
    loginDirect: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
    can: vi.fn().mockReturnValue(true),
  });
});

afterEach(() => vi.clearAllMocks());

describe('ResiliencePage — access control', () => {
  it('shows access-denied state when lacking resilience:read', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockReturnValue(false),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText(/don't have permission/i)).not.toBeNull());
    expect(mockGetResilience).not.toHaveBeenCalled();
  });
});

describe('ResiliencePage — list', () => {
  it('shows empty state when there are no entries', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText(/all providers healthy/i)).not.toBeNull());
  });

  it('shows an error state when loading fails', async () => {
    mockGetResilience.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('boom')).not.toBeNull());
  });

  it('falls back to a generic message when loading rejects with a non-Error value', async () => {
    mockGetResilience.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => expect(screen.queryByText(/failed to load resilience state/i)).not.toBeNull());
  });

  it('shows "now" for a cooldown that has already elapsed', async () => {
    mockGetResilience.mockResolvedValue({
      entries: [makeEntry({ key: { level: 'connection', id: 'conn-1' }, cooldownUntil: Date.now() - 1000 })],
      generatedAt: Date.now(),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText('now')).not.toBeNull());
  });

  it('live-updates the countdown as time passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockGetResilience.mockResolvedValue({
        entries: [makeEntry({ key: { level: 'connection', id: 'conn-1' }, cooldownUntil: Date.now() + 3000 })],
        generatedAt: Date.now(),
      });
      renderPage();
      await vi.waitFor(() => expect(screen.queryByText('3s')).not.toBeNull());

      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(screen.queryByText('2s')).not.toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('groups entries by level and shows state/fault/failures', async () => {
    mockGetResilience.mockResolvedValue({
      entries: [
        makeEntry({ key: { level: 'provider', id: 'openai' }, state: 'open', lastFault: 'server', failureCount: 5, openedAt: Date.now() }),
        makeEntry({ key: { level: 'connection', id: 'conn-1' }, state: 'closed', cooldownUntil: Date.now() + 30_000 }),
        makeEntry({ key: { level: 'model', id: 'gpt-4' }, state: 'closed', lockoutUntil: Date.now() + 300_000 }),
      ],
      generatedAt: Date.now(),
    });
    renderPage();

    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());
    expect(screen.getByText('Providers')).not.toBeNull();
    expect(screen.getByText('Connections')).not.toBeNull();
    expect(screen.getByText('Models')).not.toBeNull();
    expect(screen.getByText('open')).not.toBeNull();
    expect(screen.getByText('server')).not.toBeNull();
    expect(screen.getByText('conn-1')).not.toBeNull();
    expect(screen.getByText('gpt-4')).not.toBeNull();
  });

  it('does not render reset controls without resilience:manage', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockImplementation((p: string) => p === 'resilience:read'),
    });
    mockGetResilience.mockResolvedValue({ entries: [makeEntry()], generatedAt: Date.now() });
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /reset all/i })).toBeNull();
    expect(screen.queryByTitle('Reset')).toBeNull();
  });
});

describe('ResiliencePage — reset', () => {
  it('resets a single entry after confirming', async () => {
    const user = userEvent.setup();
    mockGetResilience.mockResolvedValue({ entries: [makeEntry()], generatedAt: Date.now() });
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());

    await user.click(screen.getByTitle('Reset'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(mockResetResilience).toHaveBeenCalledWith({ level: 'provider', id: 'openai' }));
  });

  it('resets all entries after confirming reset-all', async () => {
    const user = userEvent.setup();
    mockGetResilience.mockResolvedValue({ entries: [makeEntry()], generatedAt: Date.now() });
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /reset all/i }));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(mockResetResilience).toHaveBeenCalledWith(undefined));
  });

  it('cancels reset without calling the API', async () => {
    const user = userEvent.setup();
    mockGetResilience.mockResolvedValue({ entries: [makeEntry()], generatedAt: Date.now() });
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());

    await user.click(screen.getByTitle('Reset'));
    await user.click(screen.getByText('Cancel'));

    expect(mockResetResilience).not.toHaveBeenCalled();
  });

  it('shows an error when reset fails', async () => {
    const user = userEvent.setup();
    mockGetResilience.mockResolvedValue({ entries: [makeEntry()], generatedAt: Date.now() });
    mockResetResilience.mockRejectedValue(new Error('reset failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());

    await user.click(screen.getByTitle('Reset'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText('reset failed')).not.toBeNull());
  });

  it('falls back to a generic message when reset rejects with a non-Error value', async () => {
    const user = userEvent.setup();
    mockGetResilience.mockResolvedValue({ entries: [makeEntry()], generatedAt: Date.now() });
    mockResetResilience.mockRejectedValue('nope');
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeNull());

    await user.click(screen.getByTitle('Reset'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText(/failed to reset resilience state/i)).not.toBeNull());
  });
});
