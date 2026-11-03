import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getExperiments: vi.fn(),
  getRouters: vi.fn(),
  deleteExperiment: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../AuthContext', () => ({ useAuth: vi.fn() }));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { ExperimentsPage, useExperimentsEnabled } from './ExperimentsPage';
import { getExperiments, getRouters, deleteExperiment } from '../api';
import { useAuth } from '../AuthContext';

const mockGetExperiments = vi.mocked(getExperiments as () => Promise<unknown>);
const mockGetRouters = vi.mocked(getRouters as () => Promise<unknown>);
const mockDelete = vi.mocked(deleteExperiment as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const experiment = {
  id: 'exp-1', name: 'Cheap vs premium', description: 'Which one wins',
  rotation: 'sticky', variants: [{ id: 'v1', routerId: 'p1' }, { id: 'v2', routerId: 'p2' }],
  tokens: [{ id: 't1', tokenSnippet: 'sk-rt-aaa', createdAt: '2026-07-01T00:00:00.000Z' }],
  createdAt: '2026-07-01T00:00:00.000Z',
};
const second = { ...experiment, id: 'exp-2', name: 'Latency test', rotation: 'weighted', description: undefined };

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({ can: vi.fn((p: string) => perms.includes(p)) } as unknown as ReturnType<typeof useAuth>);
}

function renderPage() {
  return render(<MemoryRouter><ExperimentsPage /></MemoryRouter>);
}

beforeEach(() => {
  mockGetExperiments.mockResolvedValue([experiment, second]);
  mockGetRouters.mockResolvedValue([{ id: 'p1', name: 'Cheap' }, { id: 'p2', name: 'Premium' }]);
  mockDelete.mockResolvedValue(undefined);
  setAuth(['experiments:read', 'experiments:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('ExperimentsPage', () => {
  it('lists experiments with their rotation and the routers each variant routes to', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    expect(screen.getByText('Which one wins')).toBeInTheDocument();
    // A variant with no label of its own is named after its router.
    await waitFor(() => expect(screen.getAllByText('Cheap vs Premium')).toHaveLength(2));
    expect(screen.getByText('Sticky per session')).toBeInTheDocument();
    expect(screen.getByText('Random with weights')).toBeInTheDocument();
    expect(screen.getByText('2 experiments')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing to list', async () => {
    mockGetExperiments.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No experiments yet/)).toBeInTheDocument());
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getAllByTitle('Delete')[0]!);
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('exp-1'));
    await waitFor(() => expect(screen.queryByText('Cheap vs premium')).not.toBeInTheDocument());
  });

  it('reports a failed delete', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getAllByTitle('Delete')[0]!);
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.getAllByText('boom')[0]).toBeInTheDocument());
  });

  it('cancels a delete', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getAllByTitle('Delete')[0]!);
    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('opens an experiment from its name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Cheap vs premium' }).getAttribute('href'))
      .toBe('/dashboard/experiments/exp-1');
  });

  it('warns about an experiment no client can reach', async () => {
    mockGetExperiments.mockResolvedValue([{ ...experiment, tokens: [] }]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No token')).toBeInTheDocument());
  });

  it('navigates to the create page', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new experiment/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments/new');
  });

  it('opens the experiment when clicking the row', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Which one wins')).toBeInTheDocument());
    await user.click(screen.getByText('Which one wins'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments/exp-1');
  });

  it('opens the config tab from the edit icon', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Which one wins')).toBeInTheDocument());
    await user.click(screen.getAllByTitle('Edit experiment')[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments/exp-1/config');
  });

  it('hides every management action without the manage permission', async () => {
    setAuth(['experiments:read']);
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new experiment/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Edit experiment')).not.toBeInTheDocument();
  });

  it('refuses to render the list without the read permission', async () => {
    setAuth([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/don't have permission/)).toBeInTheDocument());
    expect(mockGetExperiments).not.toHaveBeenCalled();
  });

  it('reports a failed load', async () => {
    mockGetExperiments.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});

describe('useExperimentsEnabled', () => {
  it('is enabled when the list route answers', async () => {
    const { result } = renderHook(() => useExperimentsEnabled());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is disabled without the read permission, without calling the API', async () => {
    setAuth([]);
    const { result } = renderHook(() => useExperimentsEnabled());
    await waitFor(() => expect(result.current).toBe(false));
    expect(mockGetExperiments).not.toHaveBeenCalled();
  });

  it('is disabled when the module is off (403)', async () => {
    mockGetExperiments.mockRejectedValue(Object.assign(new Error('module_disabled'), { status: 403 }));
    const { result } = renderHook(() => useExperimentsEnabled());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays unresolved on any other error', async () => {
    mockGetExperiments.mockRejectedValue(Object.assign(new Error('offline'), { status: 500 }));
    const { result } = renderHook(() => useExperimentsEnabled());
    await new Promise(r => setTimeout(r, 10));
    expect(result.current).toBeNull();
  });
});
