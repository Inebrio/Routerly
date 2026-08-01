import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getExperiments: vi.fn(),
  deleteExperiment: vi.fn(),
  startExperiment: vi.fn(),
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

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({ options, value, onChange, ariaLabel }: {
    options: { value: string; label: string }[];
    value: string; onChange: (v: string) => void; ariaLabel?: string;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { ExperimentsPage, useExperimentsEnabled, STATUS_LABELS, STATUS_BADGE } from './ExperimentsPage';
import { getExperiments, deleteExperiment, startExperiment } from '../api';
import { useAuth } from '../AuthContext';

const mockGetExperiments = vi.mocked(getExperiments as () => Promise<unknown>);
const mockDelete = vi.mocked(deleteExperiment as (...a: unknown[]) => Promise<unknown>);
const mockStart = vi.mocked(startExperiment as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const draft = {
  id: 'exp-1', name: 'Cheap vs premium', description: 'Which one wins', status: 'draft',
  rotation: 'sticky', variants: [{ id: 'v1', projectId: 'p1' }, { id: 'v2', projectId: 'p2' }],
  tokens: [{ id: 't1', tokenSnippet: 'sk-rt-aaa', createdAt: '2026-07-01T00:00:00.000Z' }],
  createdAt: '2026-07-01T00:00:00.000Z',
};
const running = { ...draft, id: 'exp-2', name: 'Latency test', status: 'running', rotation: 'weighted', description: undefined };

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({ can: vi.fn((p: string) => perms.includes(p)) } as unknown as ReturnType<typeof useAuth>);
}

function renderPage() {
  return render(<MemoryRouter><ExperimentsPage /></MemoryRouter>);
}

/** Status badges only: the filter <select> repeats the same labels. */
function badgeTexts() {
  return [...document.querySelectorAll('.badge')].map(b => b.textContent);
}

beforeEach(() => {
  mockGetExperiments.mockResolvedValue([draft, running]);
  mockDelete.mockResolvedValue(undefined);
  mockStart.mockResolvedValue({ ...draft, status: 'running' });
  setAuth(['experiments:read', 'experiments:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('status maps', () => {
  it('names and colours every status', () => {
    expect(Object.keys(STATUS_LABELS)).toEqual(['draft', 'running', 'closed']);
    expect(Object.keys(STATUS_BADGE)).toEqual(['draft', 'running', 'closed']);
  });
});

describe('ExperimentsPage', () => {
  it('lists experiments with status, rotation and counts', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    expect(screen.getByText('Which one wins')).toBeInTheDocument();
    // The status filter renders the same words as <option>s, so read the badges themselves.
    expect(badgeTexts()).toEqual(['Draft', 'Running']);
    expect(screen.getByText('Sticky per session')).toBeInTheDocument();
    expect(screen.getByText('Random with weights')).toBeInTheDocument();
    expect(screen.getByText('2 experiments')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Status'), 'running');
    expect(screen.queryByText('Cheap vs premium')).not.toBeInTheDocument();
    expect(screen.getByText('Latency test')).toBeInTheDocument();
    expect(screen.getByText('1 experiment')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    mockGetExperiments.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No experiments yet/)).toBeInTheDocument());
  });

  it('starts a draft and reflects the new status', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByTitle('Start'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledWith('exp-1'));
    await waitFor(() => expect(badgeTexts()).toEqual(['Running', 'Running']));
  });

  it('surfaces a failed start', async () => {
    mockStart.mockRejectedValue(new Error('too few variants'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByTitle('Start'));
    await waitFor(() => expect(screen.getByText('too few variants')).toBeInTheDocument());
  });

  it('offers no start button once the experiment is running', async () => {
    mockGetExperiments.mockResolvedValue([running]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Latency test')).toBeInTheDocument());
    expect(screen.queryByTitle('Start')).not.toBeInTheDocument();
  });

  it('never offers delete on a running experiment', async () => {
    mockGetExperiments.mockResolvedValue([running]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Latency test')).toBeInTheDocument());
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByTitle('Delete'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('exp-1'));
    await waitFor(() => expect(screen.queryByText('Cheap vs premium')).not.toBeInTheDocument());
  });

  it('reports a failed delete', async () => {
    mockDelete.mockRejectedValue(new Error('experiment_running'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByTitle('Delete'));
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.getByText('experiment_running')).toBeInTheDocument());
  });

  it('cancels a delete', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByTitle('Delete'));
    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('opens an experiment', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getAllByTitle('Open')[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments/exp-1');
  });

  it('navigates to the create page', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new experiment/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments/new');
  });

  it('hides every management action without the manage permission', async () => {
    setAuth(['experiments:read']);
    renderPage();
    await waitFor(() => expect(screen.getByText('Cheap vs premium')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new experiment/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Start')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
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
