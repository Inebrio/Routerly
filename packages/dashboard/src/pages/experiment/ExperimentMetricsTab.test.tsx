import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  getExperimentMetrics: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('./ExperimentLayout', () => ({ useExperiment: vi.fn() }));

import { ExperimentMetricsTab } from './ExperimentMetricsTab';
import { getExperimentMetrics, getProjects } from '../../api';
import { useExperiment } from './ExperimentLayout';

const mockGetMetrics = vi.mocked(getExperimentMetrics as (...a: unknown[]) => Promise<unknown>);
const mockGetProjects = vi.mocked(getProjects as () => Promise<unknown>);
const mockUseExperiment = vi.mocked(useExperiment);

const experiment = {
  id: 'exp-1', name: 'Cheap vs premium', rotation: 'sticky',
  variants: [{ id: 'v1', projectId: 'p1', name: 'Cheap' }, { id: 'v2', projectId: 'p2', name: 'Premium' }],
  tokens: [], createdAt: '2026-07-01T00:00:00.000Z',
};

const metrics = {
  experimentId: 'exp-1', minSamplesPerVariant: 30, totalCalls: 120, ready: true,
  variants: [
    { variantId: 'v1', projectId: 'p1', name: 'Cheap', calls: 60, errors: 0, errorRate: 0, cost: 0.6, avgCostPerCall: 0.01, inputTokens: 100, outputTokens: 200, avgLatencyMs: 900, p95LatencyMs: 1400, judgedCalls: 10, avgScore: 6.4, enoughSamples: true },
    { variantId: 'v2', projectId: 'p2', name: 'Premium', calls: 60, errors: 3, errorRate: 0.05, cost: 3, avgCostPerCall: 0.05, inputTokens: 100, outputTokens: 220, avgLatencyMs: 1500, p95LatencyMs: 2600, judgedCalls: 10, avgScore: 8.2, enoughSamples: true },
  ],
};

const setExperiment = vi.fn();

/** The range picker is the shared one: its trigger is the only .btn-secondary here. */
const openPicker = () => userEvent.click(document.querySelector('button.btn-secondary') as HTMLElement);
const today = () => new Date().toISOString().slice(0, 10);

function setContext(experiment: unknown) {
  mockUseExperiment.mockReturnValue({ experiment, setExperiment } as unknown as ReturnType<typeof useExperiment>);
}

beforeEach(() => {
  mockGetMetrics.mockResolvedValue(metrics);
  mockGetProjects.mockResolvedValue([{ id: 'p1', name: 'Small model' }, { id: 'p2', name: 'Big model' }]);
  setContext(experiment);
});

afterEach(() => vi.clearAllMocks());

describe('ExperimentMetricsTab', () => {
  it('renders one row per variant with cost, latency and judge score', async () => {
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
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
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(mockGetMetrics).toHaveBeenCalledWith('exp-1', {}));
    await openPicker();
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    const from = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
    await waitFor(() => expect(mockGetMetrics).toHaveBeenLastCalledWith('exp-1', { from, to: today() }));
  });

  it('summarises the comparison above the table', async () => {
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('Cheapest per call')).toBeInTheDocument());
    // The cheapest arm is named on its card, with the gap to the priciest one.
    expect(screen.getByText('$0.01 vs $0.05')).toBeInTheDocument();
    expect(screen.getByText('+400% on the most expensive arm')).toBeInTheDocument();
    expect(screen.getByText('Fastest')).toBeInTheDocument();
    expect(screen.getByText('900 ms vs 1500 ms on average')).toBeInTheDocument();
    expect(screen.getByText('Best judge score')).toBeInTheDocument();
    expect(screen.getByText('8.2 / 10 over 20 judged calls, all time')).toBeInTheDocument();
  });

  it('shows each row distance from the best arm', async () => {
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('120 calls measured')).toBeInTheDocument());
    // Premium costs 5x the cheap arm and is 67% slower; the best arm carries no gap.
    expect(screen.getByText('+400%')).toBeInTheDocument();
    expect(screen.getByText('+67%')).toBeInTheDocument();
    expect(screen.getByText('-22%')).toBeInTheDocument();
  });

  it('shows tokens and time to first token per variant', async () => {
    mockGetMetrics.mockResolvedValue({
      ...metrics,
      variants: [{ ...metrics.variants[0]!, avgTtftMs: 240 }, metrics.variants[1]!],
    });
    render(<ExperimentMetricsTab />);
    await waitFor(() => expect(screen.getByText('100 / 200')).toBeInTheDocument());
    expect(screen.getByText('240 ms')).toBeInTheDocument();
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
    // Judge score is the last cell of each row; TTFT is blank here too.
    await waitFor(() => expect([...document.querySelectorAll('tbody tr')]
      .map(r => r.querySelector('td:last-child')!.textContent)).toEqual(['—', '—']));
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
