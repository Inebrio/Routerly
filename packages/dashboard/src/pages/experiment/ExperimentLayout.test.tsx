import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../api', () => ({ getExperiment: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ExperimentLayout, useExperiment } from './ExperimentLayout';
import { getExperiment } from '../../api';

const mockGet = vi.mocked(getExperiment as (...a: unknown[]) => Promise<unknown>);

const experiment = {
  id: 'exp-1', name: 'Cheap vs premium',
  rotation: 'sticky', variants: [], tokens: [], createdAt: '2026-07-01T00:00:00.000Z',
};

/** Proves the tabs receive the loaded experiment through the outlet context. */
function Probe() {
  const { experiment: e } = useExperiment();
  return <div data-testid="probe">{e ? e.name : 'no experiment'}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/experiments/new" element={<ExperimentLayout />}>
          <Route index element={<Probe />} />
        </Route>
        <Route path="/dashboard/experiments/:id" element={<ExperimentLayout />}>
          <Route index element={<Probe />} />
          <Route path="config" element={<Probe />} />
          <Route path="metrics" element={<div>metrics tab</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGet.mockResolvedValue(experiment);
});

afterEach(() => vi.clearAllMocks());

describe('ExperimentLayout', () => {
  it('loads the experiment and hands it to the tab', async () => {
    renderAt('/dashboard/experiments/exp-1');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Cheap vs premium'));
    expect(mockGet).toHaveBeenCalledWith('exp-1');
    expect(screen.getByRole('heading', { name: 'Cheap vs premium' })).toBeInTheDocument();
    expect(screen.getByText('exp-1')).toBeInTheDocument();
  });

  it('links the tabs to the experiment routes', async () => {
    renderAt('/dashboard/experiments/exp-1/config');
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /metrics/i })).toHaveAttribute('href', '/dashboard/experiments/exp-1/metrics');
    expect(screen.getByRole('link', { name: /token/i })).toHaveAttribute('href', '/dashboard/experiments/exp-1/token');
  });

  it('creates without loading anything and locks the tabs that need a saved experiment', () => {
    renderAt('/dashboard/experiments/new');
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New Experiment' })).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('no experiment');
    expect(screen.queryByRole('link', { name: /metrics/i })).not.toBeInTheDocument();
    // Metrics and Token both need a saved experiment; only Configuration stays live.
    expect(screen.getAllByTitle('Save the experiment first to unlock this tab')).toHaveLength(2);
  });

  it('replaces the page with the error when the experiment is gone', async () => {
    mockGet.mockRejectedValue(new Error('Not found'));
    const user = userEvent.setup();
    renderAt('/dashboard/experiments/exp-1');
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument());
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to experiments/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments');
  });

  it('goes back to the list from the header', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard/experiments/exp-1');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Cheap vs premium'));
    await user.click(screen.getByTitle('Back to experiments'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/experiments');
  });
});
