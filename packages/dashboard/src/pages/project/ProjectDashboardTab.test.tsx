import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectDashboardTab } from './ProjectDashboardTab';

vi.mock('../../api', () => ({
  getUsage: vi.fn(),
}));

// ponytail: mock DateRangePicker as a plain controlled input
vi.mock('../../components/DateRangePicker', () => ({
  DateRangePicker: ({ value, onChange }: {
    value: { from: string; to: string; label: string };
    onChange: (v: { from: string; to: string; label: string }) => void;
  }) => (
    <input
      data-testid="date-range-picker"
      value={value.label}
      onChange={e => onChange({ from: '2024-01-01', to: '2024-01-31', label: e.target.value })}
    />
  ),
  RECENT_PRESETS: [
    { label: 'Last 1h', range: () => ({ from: '2024-06-01T09:00:00Z', to: '2024-06-01T10:00:00Z', label: 'Last 1h' }) },
  ],
}));

import { getUsage } from '../../api';
const mockGetUsage = vi.mocked(getUsage as (...a: unknown[]) => Promise<unknown>);

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      totalCost: 0.003,
      totalCalls: 10,
      successCalls: 9,
      errorCalls: 1,
      blockedCalls: 0,
      completionCalls: 8,
      completionCost: 0.0028,
      routingCalls: 2,
      routingCost: 0.0002,
      latencyMedianMs: 780,
      latencyP95Ms: 2450,
      ttftMedianMs: 210,
      ttftP95Ms: 900,
      ttftSamples: 8,
    },
    byModel: {
      cheap: { calls: 8, inputTokens: 800, outputTokens: 400, cachedInputTokens: 0, cost: 0.002, errors: 0, success: 8, avgLatencyMs: 700, p95LatencyMs: 900 },
      expensive: { calls: 2, inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, cost: 0.001, errors: 1, success: 1, avgLatencyMs: 1200, p95LatencyMs: 2450 },
    },
    timeline: [],
    records: [],
    pagination: { page: 1, pageSize: 1, totalRecords: 10, totalPages: 10 },
    savings: {
      comparedCalls: 9,
      comparedCost: 0.003,
      comparedLatencyMs: 9000,
      comparedInputTokens: 1000,
      comparedOutputTokens: 500,
      cache: { inputTokens: 400, cost: 0.0009 },
      baselines: [
        { modelId: 'cheap', cost: 0.003, costDelta: 0, costDeltaPercent: 0, latencyMs: 8000, latencyDeltaMs: -1000, latencySamples: 8 },
        { modelId: 'expensive', cost: 0.03, costDelta: 0.027, costDeltaPercent: 90, latencySamples: 0 },
      ],
    },
    ...overrides,
  };
}

function renderTab() {
  function LayoutWrapper() {
    return <Outlet context={{ project: { id: 'proj-1', name: 'Test', models: [] }, setProject: vi.fn() }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/projects/proj-1/dashboard']}>
      <Routes>
        <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
          <Route path="dashboard" element={<ProjectDashboardTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('ProjectDashboardTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetUsage.mockResolvedValue(makeStats());
  });

  it('asks the service for the savings block, scoped to the project', async () => {
    renderTab();
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalled());
    const args = mockGetUsage.mock.calls[0]!;
    expect(args[1]).toBe('proj-1');
    expect(args[6]).toEqual({ savings: true });
  });

  it('headlines the saving against the most expensive target', async () => {
    renderTab();
    expect(await screen.findByText('$0.0270')).toBeInTheDocument();
    expect(screen.getByText(/for everything/).textContent).toContain('expensive');
  });

  it('shows latency and TTFT median with p95 alongside', async () => {
    renderTab();
    expect(await screen.findByText('780 ms')).toBeInTheDocument();
    expect(screen.getByText(/p95 2,450 ms/)).toBeInTheDocument();
    expect(screen.getByText('210 ms')).toBeInTheDocument();
    expect(screen.getByText(/p95 900 ms/)).toBeInTheDocument();
  });

  it('says so when no call carried a TTFT', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      summary: { ...makeStats().summary, ttftSamples: 0 },
    }));
    renderTab();
    expect(await screen.findByText('not measured on these calls')).toBeInTheDocument();
  });

  it('reports tokens and the prompt-cache saving', async () => {
    renderTab();
    await screen.findByText('780 ms');
    expect(screen.getByText('1,000')).toBeInTheDocument(); // input tokens
    expect(screen.getByText('500')).toBeInTheDocument();   // output tokens
    expect(screen.getByText(/400/)).toBeInTheDocument();   // cached tokens
    expect(screen.getByText(/\$0\.0009 saved/)).toBeInTheDocument();
  });

  it('lists one counterfactual row per target, with no time estimate when there is no sample', async () => {
    renderTab();
    await screen.findByText('780 ms');
    expect(screen.getByText('$0.0300')).toBeInTheDocument();
    expect(screen.getByText('no sample')).toBeInTheDocument();
    expect(screen.getByText('8,000 ms')).toBeInTheDocument();
  });

  it('shows the routing distribution per model', async () => {
    renderTab();
    await screen.findByText('780 ms');
    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
  });

  it('invites the user to add targets when the project has none', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      savings: { ...makeStats().savings, baselines: [] },
    }));
    renderTab();
    expect(await screen.findByText('Add target models to this project to see the comparison.')).toBeInTheDocument();
  });

  it('renders an empty state when the project saw no traffic', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      summary: { ...makeStats().summary, totalCalls: 0 },
    }));
    renderTab();
    expect(await screen.findByText('No traffic for this project in the selected period.')).toBeInTheDocument();
  });

  it('refetches when the period changes', async () => {
    renderTab();
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('date-range-picker'), { target: { value: 'Last 1h' } });
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledTimes(2));
    // a recent preset recomputes its window on every fetch
    expect(mockGetUsage.mock.calls[1]![2]).toBe('2024-06-01T09:00:00Z');
  });

  it('surfaces a failed fetch', async () => {
    mockGetUsage.mockRejectedValue(new Error('forbidden'));
    renderTab();
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
  });
});
