import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { RouterOrchestratorTab } from './RouterOrchestratorTab';

vi.mock('../../api', () => ({
  getRouters: vi.fn(),
  updateRouter: vi.fn(),
}));

// ponytail: mock useUnsavedChanges — blocker not needed in unit tests
vi.mock('../../hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: vi.fn(() => ({ isBlocked: false, proceed: vi.fn(), reset: vi.fn() })),
  UnsavedChangesModal: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="unsaved-modal">
      <button onClick={onConfirm}>Leave anyway</button>
      <button onClick={onCancel}>Stay</button>
    </div>
  ),
}));

// ponytail: mock SearchableSelect as a plain <select> so options/onChange are testable
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { getRouters, updateRouter } from '../../api';

const mockGetRouters = vi.mocked(getRouters as () => Promise<unknown>);
const mockUpdateRouter = vi.mocked(updateRouter as (...a: unknown[]) => Promise<unknown>);

const orchestrator = {
  id: 'orch-1',
  name: 'My Orchestrator',
  kind: 'orchestrator',
  models: [],
  candidates: [],
};

const allRouters = [
  orchestrator,
  { id: 'router-a', name: 'Router A', kind: 'router', models: [] },
  { id: 'router-b', name: 'Router B', kind: 'router', models: [] },
  { id: 'orch-2', name: 'Other Orchestrator', kind: 'orchestrator', models: [] },
];

function renderTab(router: Record<string, unknown> = orchestrator) {
  const setRouter = vi.fn();
  function LayoutWrapper() {
    return <Outlet context={{ router, setRouter }} />;
  }
  return {
    setRouter,
    ...render(
      <MemoryRouter initialEntries={[`/dashboard/routers/${router.id}/orchestrator`]}>
        <Routes>
          <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
            <Route path="orchestrator" element={<RouterOrchestratorTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}

beforeEach(() => {
  mockGetRouters.mockResolvedValue(allRouters);
  mockUpdateRouter.mockResolvedValue({ ...orchestrator });
});

afterEach(() => vi.clearAllMocks());

describe('RouterOrchestratorTab — empty state', () => {
  it('shows empty-state message when the router has no candidates', async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText(/No candidate routers yet/i)).toBeTruthy()
    );
  });
});

describe('RouterOrchestratorTab — candidate options (AC7 opacity + kind filter)', () => {
  it('offers only routers of kind "router" — not other orchestrators, not itself', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Candidate/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Candidate/i }));

    const select = await screen.findByTestId('searchable-Select router');
    const optionLabels = Array.from(select.querySelectorAll('option')).map(o => o.textContent);

    expect(optionLabels).toContain('Router A');
    expect(optionLabels).toContain('Router B');
    expect(optionLabels).not.toContain('My Orchestrator');
    expect(optionLabels).not.toContain('Other Orchestrator');
  });
});

describe('RouterOrchestratorTab — add row and save', () => {
  it('adds a row and calls updateRouter with the candidates payload on save', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Candidate/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Candidate/i }));

    const select = await screen.findByTestId('searchable-Select router');
    await userEvent.selectOptions(select, 'router-b');

    const weightInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    await userEvent.clear(weightInput);
    await userEvent.type(weightInput, '3');

    await userEvent.click(screen.getByRole('button', { name: /Save Candidates/i }));

    await waitFor(() =>
      expect(mockUpdateRouter).toHaveBeenCalledWith(
        'orch-1',
        expect.objectContaining({ candidates: [{ routerId: 'router-b', weight: 3 }] })
      )
    );
  });
});

describe('RouterOrchestratorTab — save failure', () => {
  it('renders the server error message verbatim on a failed save', async () => {
    mockUpdateRouter.mockRejectedValueOnce(new Error('An orchestrator cannot target itself'));
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Candidate/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Candidate/i }));
    await userEvent.click(screen.getByRole('button', { name: /Save Candidates/i }));

    await waitFor(() =>
      expect(screen.getByText('An orchestrator cannot target itself')).toBeTruthy()
    );
  });

  it('shows a generic message when a non-Error is thrown', async () => {
    mockUpdateRouter.mockRejectedValueOnce('string error');
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Candidate/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Candidate/i }));
    await userEvent.click(screen.getByRole('button', { name: /Save Candidates/i }));

    await waitFor(() =>
      expect(screen.getByText('Error saving orchestrator candidates')).toBeTruthy()
    );
  });
});
