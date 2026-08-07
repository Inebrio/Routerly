import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

let mockCan = true;

// ponytail: pages gate write affordances on can(); default the mock to a full-permission user
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ can: () => mockCan }),
}));

vi.mock('../api', () => ({
  getRouters: vi.fn(),
  deleteRouter: vi.fn(),
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

const navigateFn = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateFn };
});

import { RoutersPage } from './RoutersPage';
import { getRouters, deleteRouter } from '../api';

const mockGetRouters  = vi.mocked(getRouters as () => Promise<unknown>);
const mockDeleteRouter = vi.mocked(deleteRouter as (...a: unknown[]) => Promise<unknown>);

function makeRouter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'My Router',
    models: [{ modelId: 'openai/gpt-4o' }],
    tokens: [{ id: 't1', name: 'tok' }],
    policies: [],
    ...overrides,
  };
}

function renderPage(path = '/dashboard/routers') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RoutersPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockCan = true;
  mockGetRouters.mockResolvedValue([]);
  mockDeleteRouter.mockResolvedValue(undefined);
});

afterEach(() => { vi.clearAllMocks(); navigateFn.mockReset(); });

// ── Loading state ──────────────────────────────────────────────────────────────

describe('RoutersPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetRouters.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('RoutersPage — empty state', () => {
  it('shows empty state when no routers', async () => {
    mockGetRouters.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('No routers yet.')).not.toBeNull());
  });

  it('shows 0 routers in toolbar', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('0 routers')).not.toBeNull());
  });
});

// ── Loaded with routers ───────────────────────────────────────────────────────

describe('RoutersPage — loaded state', () => {
  it('renders router rows in table', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeNull());
  });

  it('shows singular "1 router" in toolbar', async () => {
    mockGetRouters.mockResolvedValue([makeRouter()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1 router')).not.toBeNull());
  });

  it('shows plural "2 routers" in toolbar', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ id: 'p1', name: 'A' }), makeRouter({ id: 'p2', name: 'B' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('2 routers')).not.toBeNull());
  });

  it('shows token count', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ tokens: [{ id: 't1' }, { id: 't2' }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('2 tokens')).not.toBeNull());
  });

  it('shows singular "1 token"', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ tokens: [{ id: 't1' }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1 token')).not.toBeNull());
  });

  it('shows "0 tokens" when tokens array is missing', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ tokens: undefined })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('0 tokens')).not.toBeNull());
  });

  it('shows model IDs joined', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ models: [{ modelId: 'openai/gpt-4o' }, { modelId: 'anthropic/claude-3' }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai/gpt-4o, anthropic/claude-3')).not.toBeNull());
  });

  it('renders enabled policy badges', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({
      policies: [{ type: 'budget', enabled: true }, { type: 'ratelimit', enabled: false }],
    })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('budget')).not.toBeNull());
    expect(screen.queryByText('ratelimit')).toBeNull();
  });

  it('shows dash when no enabled policies', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ policies: [{ type: 'ratelimit', enabled: false }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('—')).not.toBeNull());
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('RoutersPage — navigation', () => {
  it('shows no creation button on the "All" tab', async () => {
    renderPage();
    await waitFor(() => screen.getByText('0 routers'));
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
  });

  it('"New Router" button on the Router tab navigates to the dedicated router form', async () => {
    renderPage('/dashboard/routers?tab=router');
    await waitFor(() => screen.getByRole('button', { name: /New Router/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Router/ }));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/routers/new/router');
  });

  it('"New Orchestrator" button on the Orchestrator tab navigates to the dedicated orchestrator form', async () => {
    renderPage('/dashboard/routers?tab=orchestrator');
    await waitFor(() => screen.getByRole('button', { name: /New Orchestrator/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Orchestrator/ }));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/routers/new/orchestrator');
  });

  it('"New Passthrough" button on the Passthrough tab navigates to the dedicated passthrough form', async () => {
    renderPage('/dashboard/routers?tab=passthrough');
    await waitFor(() => screen.getByRole('button', { name: /New Passthrough/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Passthrough/ }));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/routers/new/passthrough');
  });

  it('navigates to the router settings form on edit click', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Edit router'));
    await userEvent.click(screen.getByTitle('Edit router'));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/routers/p1/general');
  });

  it('navigates to router detail on row click', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => screen.getByText('Alpha'));
    await userEvent.click(screen.getByText('Alpha'));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/routers/p1');
  });
});

// ── Delete flow ────────────────────────────────────────────────────────────────

describe('RoutersPage — delete flow', () => {
  it('shows confirm dialog when delete clicked', async () => {
    mockGetRouters.mockResolvedValue([makeRouter()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete router'));
    await userEvent.click(screen.getByTitle('Delete router'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeNull());
    expect(screen.queryByText('Delete this router?')).not.toBeNull();
  });

  it('dismisses dialog on cancel', async () => {
    mockGetRouters.mockResolvedValue([makeRouter()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete router'));
    await userEvent.click(screen.getByTitle('Delete router'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(mockDeleteRouter).not.toHaveBeenCalled();
  });

  it('removes router from list after confirmed delete', async () => {
    mockGetRouters.mockResolvedValue([makeRouter({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete router'));
    await userEvent.click(screen.getByTitle('Delete router'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(mockDeleteRouter).toHaveBeenCalledWith('p1');
  });

  it('shows error when deleteRouter throws', async () => {
    mockGetRouters.mockResolvedValue([makeRouter()]);
    mockDeleteRouter.mockRejectedValue(new Error('Server error'));
    renderPage();
    await waitFor(() => screen.getByTitle('Delete router'));
    await userEvent.click(screen.getByTitle('Delete router'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Server error')).not.toBeNull());
  });

  it('shows generic error when deleteRouter throws non-Error', async () => {
    mockGetRouters.mockResolvedValue([makeRouter()]);
    mockDeleteRouter.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => screen.getByTitle('Delete router'));
    await userEvent.click(screen.getByTitle('Delete router'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Error deleting router')).not.toBeNull());
  });
});

// ── Permissions ───────────────────────────────────────────────────────────────

describe('RoutersPage — permissions', () => {
  it('hides create and delete affordances without router:write', async () => {
    mockCan = false;
    mockGetRouters.mockResolvedValue([makeRouter()]);
    renderPage('/dashboard/routers?tab=router');
    await waitFor(() => screen.getByText('My Router'));
    expect(screen.queryByRole('button', { name: /New Router/i })).toBeNull();
    expect(screen.queryByTitle('Delete router')).toBeNull();
    expect(screen.getByTitle('Edit router')).toBeTruthy();
  });
});
