import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  getExperimentMetrics: vi.fn(),
  getProjects: vi.fn(),
  closeExperiment: vi.fn(),
}));

vi.mock('../../AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./ExperimentLayout', () => ({ useExperiment: vi.fn() }));

vi.mock('../../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ options, value, onChange, ariaLabel }: {
    options: { value: string; label: string }[];
    value: string; onChange: (v: string) => void; ariaLabel?: string;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { ExperimentMetricsTab } from './ExperimentMetricsTab';
import { getExperimentMetrics, getProjects, closeExperiment } from '../../api';
import { useAuth } from '../../AuthContext';
import { useExperiment } from './ExperimentLayout';

const mockGetMetrics = vi.mocked(getExperimentMetrics as (...a: unknown[]) => Promise<unknown>);
const mockGetProjects = vi.mocked(getProjects as () => Promise<unknown>);
const mockClose = vi.mocked(closeExperiment as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);
const mockUseExperiment = vi.mocked(useExperiment);

const running = {
  id: 'exp-1', name: 'Cheap vs premium', status: 'running', rotation: 'sticky',
  variants: [{ id: 'v1', projectId: 'p1', name: 'Cheap' }, { id: 'v2', projectId: 'p2', name: 'Premium' }],
  tokens: [], createdAt: '2026-07-01T00:00:00.000Z',
};

const metrics = {
  experimentId: 'exp-1', status: 'running', minSamplesPerVariant: 30, totalCalls: 120, ready: true,
  variants: [
    { variantId: 'v1', projectId: 'p1', name: 'Cheap', calls: 60, errors: 0, errorRate: 0, cost: 0.6, avgCostPerCall: 0.01, inputTokens: 100, outputTokens: 200, avgLatencyMs: 900, p95LatencyMs: 1400, judgedCalls: 10, avgScore: 6.4, enoughSamples: true },
    { variantId: 'v2', projectId: 'p2', name: 'Premium', calls: 60, errors: 3, errorRate: 0.05, cost: 3, avgCostPerCall: 0.05, inputTokens: 100, outputTokens: 220, avgLatencyMs: 1500, p95LatencyMs: 2600, judgedCalls: 10, avgScore: 8.2, enoughSamples: true },
  ],
};

const setExperiment = vi.fn();

function setContext(experiment: unknown) {
  mockUseExperiment.mockReturnValue({ experiment, setExperiment } as unknown as ReturnType<typeof useExperiment>);
}

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({ can: vi.fn((p: string) => perms.includes(p)) } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  mockGetMetrics.mockResolvedValue(metrics);
  mockGetProjects.mockResolvedValue([{ id: 'p1', name: 'Small model' }, { id: 'p2', name: 'Big model' }]);
  mockClose.mockResolvedValue({ ...running, status: 'closed', winnerVariantId: 'v2' });
  setAuth(['experiments:read', 'experiments:manage']);
  setContext(running);
});

afterEach(() => vi.clearAllMocks());

describe('ExperimentMetricsTab', () => {
  it('renders one row per variant with cost, latency and judge score', async () => {
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    // The winner picker repeats the variant names, so read them off the table.
    const rows = [...document.querySelectorAll('tbody tr')];
    // Variant label first, then the project it routes to.
    await waitFor(() => expect(rows.map(r => r.querySelector('td')!.textContent))
      .toEqual(['CheapSmall model', 'PremiumBig model']));
    // Both variants took half the traffic.
    expect(screen.getAllByText('50.0%')).toHaveLength(2);
    expect(screen.getByText('$0.60')).toBeInTheDocument();
    expect(screen.getByText('3 (5.0%)')).toBeInTheDocument();
    expect(screen.getByText('900 ms')).toBeInTheDocument();
    expect(screen.getByText('2600 ms')).toBeInTheDocument();
    expect(screen.getByText('6.4 / 10')).toBeInTheDocument();
    expect(screen.getByText('8.2 / 10')).toBeInTheDocument();
  });

  it('measures the whole history by default and narrows to the chosen window', async () => {
    const user = userEvent.setup();
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(mockGetMetrics).toHaveBeenCalledWith('exp-1', undefined));
    await user.selectOptions(screen.getByLabelText('Time range'), '7');
    await waitFor(() => expect(mockGetMetrics).toHaveBeenLastCalledWith('exp-1', { from: expect.any(String) }));
    const calls = mockGetMetrics.mock.calls;
    const { from } = calls[calls.length - 1]![1] as { from: string };
    expect(Date.now() - new Date(from).getTime()).toBeCloseTo(7 * 86400000, -4);
  });

  it('flags a comparison that has too few calls', async () => {
    mockGetMetrics.mockResolvedValue({
      ...metrics, ready: false,
      variants: [{ ...metrics.variants[0]!, calls: 4, enoughSamples: false }, metrics.variants[1]!],
    });
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText(/Not conclusive yet/)).toBeInTheDocument());
    expect(screen.getByText('Low sample')).toBeInTheDocument();
  });

  it('shows an empty state before any call lands', async () => {
    mockGetMetrics.mockResolvedValue({ ...metrics, totalCalls: 0, variants: [] });
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText(/No calls in this window yet/)).toBeInTheDocument());
  });

  it('leaves the judge score blank when nothing was judged', async () => {
    mockGetMetrics.mockResolvedValue({
      ...metrics,
      variants: metrics.variants.map(v => ({ ...v, judgedCalls: 0, avgScore: undefined })),
    });
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(2));
  });

  it('closes the experiment with the winner the operator picked', async () => {
    const user = userEvent.setup();
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Winning variant'), 'v2');
    await user.click(screen.getByRole('button', { name: /close experiment/i }));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith('exp-1', 'v2'));
    expect(setExperiment).toHaveBeenCalled();
  });

  it('closes without a winner when none is chosen', async () => {
    const user = userEvent.setup();
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /close experiment/i }));
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith('exp-1', undefined));
  });

  it('reports a failed close', async () => {
    mockClose.mockRejectedValue(new Error('experiment_not_running'));
    const user = userEvent.setup();
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /close experiment/i }));
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.getByText('experiment_not_running')).toBeInTheDocument());
  });

  it('offers no close action on a draft or without the manage permission', async () => {
    setContext({ ...running, status: 'draft' });
    const { unmount } = render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /close experiment/i })).not.toBeInTheDocument();
    unmount();

    setContext(running);
    setAuth(['experiments:read']);
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /close experiment/i })).not.toBeInTheDocument();
  });

  it('marks the declared winner on a closed experiment', async () => {
    setContext({ ...running, status: 'closed', winnerVariantId: 'v2' });
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('Winner')).toBeInTheDocument());
  });

  it('reports a failed metrics load', async () => {
    mockGetMetrics.mockRejectedValue(new Error('offline'));
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('offline')).toBeInTheDocument());
  });

  it('renders nothing until the layout has the experiment', () => {
    setContext(null);
    const { container } = render(<ExperimentMetricsTab />);
    expect(container).toBeEmptyDOMElement();
    expect(mockGetMetrics).not.toHaveBeenCalled();
  });
});
