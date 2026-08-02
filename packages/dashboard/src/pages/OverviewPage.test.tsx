import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ponytail: stub recharts — invoke tickFormatters and render the tooltip content
// so the formatters this page passes into the chart system stay covered.
vi.mock('recharts', () => ({
  AreaChart: ({ children, data }: { children: React.ReactNode; data?: Array<Record<string, unknown>> }) => (
    <div data-testid="area-chart" data-labels={(data ?? []).map(d => d.label ?? d.date).join(',')}>{children}</div>
  ),
  Area: () => null,
  CartesianGrid: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  XAxis: ({ tickFormatter }: { tickFormatter?: (v: unknown) => string }) => {
    if (tickFormatter) tickFormatter(1.5);
    return null;
  },
  YAxis: ({ tickFormatter }: { tickFormatter?: (v: unknown) => string }) => {
    if (tickFormatter) tickFormatter(0.5);
    return null;
  },
  Tooltip: ({ content }: { content?: React.ReactElement }) =>
    content
      ? React.cloneElement(content, {
          active: true,
          label: 'gpt-4o',
          payload: [{ name: 'Cost', value: 0.123, color: '#3d75f5', dataKey: 'cost', payload: { fullName: 'openai/gpt-4o' } }],
        } as never)
      : null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../api', () => ({
  getUsage: vi.fn(),
  getModels: vi.fn(),
  getProjects: vi.fn(),
  getClients: vi.fn(),
}));

const mockUseTheme = vi.fn(() => ({ theme: 'light', setTheme: vi.fn() }));
vi.mock('../ThemeContext.js', () => ({
  get useTheme() { return mockUseTheme; },
}));

import { OverviewPage } from './OverviewPage';
import { compactCost } from '../components/savings';
import { getUsage, getModels, getProjects, getClients } from '../api';

/** "This month", the window the page opens on. */
// Local calendar days, like the picker: toISOString() is UTC, so east of Greenwich
// the first of the month reads as the last day of the previous one.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthStart = () => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), 1));
};
const today = () => iso(new Date());

/** The date range picker: its trigger is the only secondary button on the page. */
const openPicker = () => userEvent.click(document.querySelector('button.btn-secondary') as HTMLElement);

const mockGetUsage    = vi.mocked(getUsage as (...a: unknown[]) => Promise<unknown>);
const mockGetModels   = vi.mocked(getModels as () => Promise<unknown>);
const mockGetProjects = vi.mocked(getProjects as () => Promise<unknown>);
const mockGetClients  = vi.mocked(getClients as () => Promise<unknown>);

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      totalCost: 1.2345,
      totalCalls: 100,
      routingCalls: 40,
      completionCalls: 60,
      successCalls: 95,
      errorCalls: 5,
    },
    timeline: [],
    byModel: {},
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockUseTheme.mockReturnValue({ theme: 'light', setTheme: vi.fn() });
  mockGetUsage.mockResolvedValue(makeStats());
  mockGetModels.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
  mockGetProjects.mockResolvedValue([{ id: 'p1' }]);
  mockGetClients.mockResolvedValue({ enabled: true, advertisedAddresses: [], clients: [] });
});

afterEach(() => vi.clearAllMocks());

// ── Loading state ──────────────────────────────────────────────────────────────

describe('OverviewPage — loading', () => {
  it('shows spinner while stats are loading', () => {
    mockGetUsage.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('OverviewPage — error state', () => {
  it('shows permission error message when getUsage rejects', async () => {
    mockGetUsage.mockRejectedValue(new Error('forbidden'));
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText('No permission to view usage data.')).not.toBeNull()
    );
  });
});

// ── Loaded state ───────────────────────────────────────────────────────────────

describe('OverviewPage — loaded state', () => {
  it('renders page header', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('Overview')).not.toBeNull());
  });

  it('renders total cost stat card', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('$1.2345')).not.toBeNull());
    expect(screen.queryByText('Total Cost')).not.toBeNull();
  });

  it('renders total calls stat card', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('100')).not.toBeNull());
    expect(screen.queryByText('Total Calls')).not.toBeNull();
  });

  it('renders success rate stat card', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('95.0%')).not.toBeNull());
    expect(screen.queryByText('Success Rate')).not.toBeNull();
  });

  it('renders — for success rate when totalCalls is 0', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      summary: { totalCost: 0, totalCalls: 0, routingCalls: 0, completionCalls: 0, successCalls: 0, errorCalls: 0 },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('—')).not.toBeNull());
  });

  it('renders errors stat card', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('5')).not.toBeNull());
    // 'Errors' appears in stat card label and table header — both fine
    expect(screen.queryAllByText('Errors').length).toBeGreaterThan(0);
  });

  it('renders model count from getModels', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('2')).not.toBeNull());
    expect(screen.queryByText('Models')).not.toBeNull();
  });

  it('renders project count from getProjects', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('1')).not.toBeNull());
    expect(screen.queryByText('Projects')).not.toBeNull();
  });

  it('links to the Connect section while the clients module is enabled', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /Connect a client/ });
    expect(link.getAttribute('href')).toBe('/dashboard/connect');
  });

  it('hides the Connect card when the clients module is disabled', async () => {
    const err = new Error('Not found') as Error & { status?: number };
    err.status = 404;
    mockGetClients.mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Models')).not.toBeNull());
    expect(screen.queryByText('Connect a client')).toBeNull();
  });

  it('shows an empty token card when all tokens are 0', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Overview'));
    expect(screen.queryByText('0 in · 0 out')).not.toBeNull();
  });

  it('sums the per-model tokens into the token card', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 0.5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('1.5k')).not.toBeNull());
    expect(screen.queryByText('1.0k in · 500 out')).not.toBeNull();
  });

  it('adds the cached share to the token card when there is one', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 0.5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 200 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('1.0k in · 500 out · 200 cached')).not.toBeNull());
  });

  it('renders "No cost recorded" when byModel has no entries with cost>0', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: { 'openai/gpt-4o': { calls: 5, errors: 0, cost: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('No cost recorded this period.')).not.toBeNull());
  });

  it('renders Calls by Model table with rows', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 50, errors: 2, cost: 1.5, inputTokens: 5000, outputTokens: 2500, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('Calls by Model')).not.toBeNull());
    // The stubbed tooltip renders the same model id, hence the plural query.
    expect(screen.queryAllByText('openai/gpt-4o').length).toBeGreaterThan(0);
    expect(screen.queryByText('50')).not.toBeNull();
  });

  it('renders error count in red when errors > 0', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 3, cost: 0.1, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => screen.queryByText('3'));
    const errCell = screen.getByText('3').closest('td') as HTMLElement;
    expect(errCell.style.color).toContain('danger');
  });

  it('renders — when errors is 0 in calls table', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 0.1, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => screen.queryByText('Calls by Model'));
    // errors=0 → renders '—' in the errors column
    const dashCells = Array.from(document.querySelectorAll('td')).filter(td => td.textContent === '—');
    expect(dashCells.length).toBeGreaterThan(0);
  });
});

// ── Period selector (T203) ─────────────────────────────────────────────────────

describe('OverviewPage — period selector', () => {
  it('opens on this month and asks the service for that window', async () => {
    renderPage();
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledWith(
      'custom', undefined, monthStart(), today(), undefined, undefined, { series: true, savings: true },
    ));
    expect(screen.queryByText('This month')).not.toBeNull();
  });

  it('picking a preset re-reads that window', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('This month'));
    await openPicker();
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    const from = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledWith(
      'custom', undefined, from, today(), undefined, undefined, { series: true, savings: true },
    ));
  });

  it('an open-ended window falls back to the whole history', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('This month'));
    await openPicker();
    await userEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledWith(
      'all', undefined, undefined, undefined, undefined, undefined, { series: true, savings: true },
    ));
  });
});

// ── Cost by model ──────────────────────────────────────────────────────────────

describe('OverviewPage — cost by model', () => {
  it('renders bar chart for cost by model', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 1.5, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('bar-chart')).not.toBeNull());
  });

  it('sorts bar data by cost descending when multiple models present (exercises sort comparator)', async () => {
    // Two models with cost > 0 — forces the sort comparator to run
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 0.5, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        'anthropic/claude-3-opus': { calls: 5, errors: 0, cost: 2.0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('bar-chart')).not.toBeNull());
  });

  it('getModels error is caught silently (console.error)', async () => {
    mockGetModels.mockRejectedValue(new Error('models error'));
    renderPage();
    await waitFor(() => screen.queryByText('Overview'));
    // Page still renders without crash
    expect(screen.queryByText('Total Cost')).not.toBeNull();
  });

  it('getProjects error is caught silently', async () => {
    mockGetProjects.mockRejectedValue(new Error('projects error'));
    renderPage();
    await waitFor(() => screen.queryByText('Overview'));
    expect(screen.queryByText('Total Cost')).not.toBeNull();
  });
});

// ── Dark theme branch ──────────────────────────────────────────────────────────

describe('OverviewPage — dark theme', () => {
  it('renders without crash when theme is dark (isDark=true)', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() });
    renderPage();
    await waitFor(() => expect(screen.queryByText('Overview')).not.toBeNull());
    mockUseTheme.mockReturnValue({ theme: 'light', setTheme: vi.fn() });
  });

  it('isDark true when theme=auto and matchMedia does not match light', async () => {
    // Stub matchMedia to return matches=false for prefers-color-scheme: light
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: false }),
      configurable: true,
      writable: true,
    });
    mockUseTheme.mockReturnValue({ theme: 'auto', setTheme: vi.fn() });
    renderPage();
    await waitFor(() => expect(screen.queryByText('Overview')).not.toBeNull());
    mockUseTheme.mockReturnValue({ theme: 'light', setTheme: vi.fn() });
  });
});

// ── Savings over time (T81) ───────────────────────────────────────────────────

const SERIES = {
  bucket: 'day' as const,
  baselineModelId: 'openai/gpt-4o',
  // Cheapest first, same order the service ships (T100).
  baselineModelIds: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
  points: [
    {
      bucket: '2026-07-31', calls: 2, cost: 0.006, baselineCost: 0.06,
      baselineCosts: { 'openai/gpt-4o-mini': 0.01, 'anthropic/claude-sonnet-4': 0.03, 'openai/gpt-4o': 0.06 },
      inputTokens: 2000, outputTokens: 1000, cachedInputTokens: 0, latencyMs: 2000, baselineLatencyMs: 4000,
    },
    {
      bucket: '2026-08-01', calls: 1, cost: 0.003, baselineCost: 0.03,
      baselineCosts: { 'openai/gpt-4o-mini': 0.005, 'anthropic/claude-sonnet-4': 0.015, 'openai/gpt-4o': 0.03 },
      inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, latencyMs: 1000, baselineLatencyMs: 2000,
    },
  ],
};

const SAVINGS = {
  comparedCalls: 3,
  comparedCost: 0.009,
  comparedLatencyMs: 3000,
  comparedInputTokens: 3000,
  comparedOutputTokens: 1500,
  cache: { inputTokens: 0, cost: 0 },
  baselines: [
    { modelId: 'openai/gpt-4o-mini', cost: 0.015, costDelta: 0.006, costDeltaPercent: 40, latencyMs: 4500, latencyDeltaMs: 1500, latencySamples: 3, tokensEstimated: 4500, tokenDelta: 0 },
    { modelId: 'anthropic/claude-sonnet-4', cost: 0.045, costDelta: 0.036, costDeltaPercent: 80, latencyMs: 6000, latencyDeltaMs: 3000, latencySamples: 2, tokensEstimated: 5175, tokenDelta: 675 },
    { modelId: 'openai/gpt-4o', cost: 0.09, costDelta: 0.081, costDeltaPercent: 90, latencyMs: 5000, latencyDeltaMs: 2000, latencySamples: 1, tokensEstimated: 4500, tokenDelta: 0 },
  ],
  optimizers: [{ id: 'rtk', calls: 3, tokensSaved: 1200, costSaved: 0.002, rolledBack: 0 }],
};

describe('OverviewPage — savings over time', () => {
  it('asks the service for the series and the totals', async () => {
    renderPage();
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledWith(
      'custom', undefined, monthStart(), today(), undefined, undefined, { series: true, savings: true },
    ));
  });

  it('stays hidden when the service returned no series', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Overview'));
    expect(screen.queryByText('What routing saved')).toBeNull();
  });

  it('says how many calls were compared and against how many models', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    const card = screen.getByText('What routing saved').closest('.chart-card')!;
    expect(card.textContent).toContain('3 client calls');
    expect(screen.getByRole('link', { name: '3 paid models in play' }).getAttribute('href')).toBe('/dashboard/models');
  });

  it('draws one dashed line per paid baseline, all but the two ends hidden', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    const state = (label: string) =>
      screen.getByRole('button', { name: new RegExp(`^${label}$`) }).getAttribute('aria-pressed');
    expect(state('gpt-4o-mini')).toBe('true');   // cheapest end
    expect(state('gpt-4o')).toBe('true');        // costliest end
    expect(state('claude-sonnet-4')).toBe('false'); // in between, one click away
  });

  it('recomputes which lines start visible when the period changes the baseline set', async () => {
    // One paid model in the first window, three in the next one: the two ends
    // of the new set stay visible and the one in between goes back to hidden.
    mockGetUsage
      .mockResolvedValueOnce(makeStats({ series: { ...SERIES, baselineModelIds: ['openai/gpt-4o'] }, savings: SAVINGS }))
      .mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    await openPicker();
    await userEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^claude-sonnet-4$/ })).not.toBeNull());
    expect(screen.getByRole('button', { name: /^claude-sonnet-4$/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /^gpt-4o-mini$/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles a baseline line from its legend entry', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    const middle = screen.getByRole('button', { name: /^claude-sonnet-4$/ });
    await userEvent.click(middle);
    expect(middle.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(middle);
    expect(middle.getAttribute('aria-pressed')).toBe('false');
  });

  it('carries the money saved on the Total Cost card, anchored on the costliest baseline', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('$0.0810 saved (90%) vs always gpt-4o')).not.toBeNull());
    // No card of its own: the saving belongs to the number it changes (T201).
    expect(screen.queryByText('Cost saved')).toBeNull();
    const card = screen.getByText('Total Cost').closest('.stat-card')!;
    expect(card.textContent).toContain('$1.2345');
  });

  it('carries what the optimizers cut on the token card', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('1.2k cut by optimizers')).not.toBeNull());
    // Time saved was an estimate nobody could check: it is gone for good.
    expect(screen.queryByText('Time saved')).toBeNull();
    expect(screen.queryByText(/estimated/)).toBeNull();
  });

  it('shows the tokenizer estimate when the optimizers cut nothing', async () => {
    const savings = { ...SAVINGS, optimizers: [], baselines: SAVINGS.baselines.map(b => ({ ...b, tokenDelta: 675 })) };
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('675 fewer than always gpt-4o, estimated')).not.toBeNull());
  });

  // T202 — a saving that is zero or negative is a window too small to compare,
  // not news: no line, no bar.
  it('drops every saving that is not positive', async () => {
    const savings = {
      ...SAVINGS,
      optimizers: [],
      baselines: SAVINGS.baselines.map(b => ({ ...b, costDelta: -0.01, tokenDelta: 0 })),
    };
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    expect(screen.queryByText(/saved \(/)).toBeNull();
    expect(screen.queryByText(/cut by optimizers/)).toBeNull();
  });

  it('drops the saving lines when no baseline costs anything', async () => {
    const savings = { ...SAVINGS, optimizers: [], baselines: SAVINGS.baselines.map(b => ({ ...b, cost: 0 })) };
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    expect(screen.queryByText(/saved \(/)).toBeNull();
    expect(screen.queryByText(/estimated/)).toBeNull();
  });

  it('switches the chart between cost and tokens', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    // Cost: actual against every paid baseline
    expect(screen.getByRole('button', { name: /^gpt-4o$/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Tokens' }));
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText('Output')).toBeTruthy();

    expect(screen.queryByRole('button', { name: 'Speed' })).toBeNull();
  });

  it('drops the cost counterfactual when no baseline model applies', async () => {
    const noBaseline = { ...SERIES, baselineModelIds: [] };
    mockGetUsage.mockResolvedValue(makeStats({ series: noBaseline }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    // A single series draws no legend at all, so nothing is left to toggle
    expect(screen.queryByRole('button', { name: /gpt-4o/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /paid models/ })).toBeNull();
  });

  it('labels hourly buckets by the hour and daily ones by the date', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      series: { bucket: 'hour', baselineModelIds: [], points: [{ ...SERIES.points[0], bucket: '2026-08-01T09' }] },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    const chart = screen.getByText('What routing saved').closest('.chart-card')!.querySelector('[data-testid="area-chart"]');
    expect(chart?.getAttribute('data-labels')).toBe('09:00');
  });

  it('labels daily buckets by the date', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ series: SERIES, savings: SAVINGS }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('What routing saved')).not.toBeNull());
    const chart = screen.getByText('What routing saved').closest('.chart-card')!.querySelector('[data-testid="area-chart"]');
    expect(chart?.getAttribute('data-labels')).toBe('07-31,08-01');
  });
});

// ── Cross-links (T81) ─────────────────────────────────────────────────────────

describe('OverviewPage — stat card links', () => {
  it('points each stat at the section that explains it', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Total Cost'));
    const links = Object.fromEntries(
      [...document.querySelectorAll('a.stat-card')]
        .map(a => [a.querySelector('.stat-label')?.textContent, a.getAttribute('href')]),
    );
    expect(links).toEqual({
      'Total Cost': '/dashboard/usage',
      Tokens: '/dashboard/usage',
      'Total Calls': '/dashboard/usage',
      'Success Rate': '/dashboard/usage',
      Errors: '/dashboard/usage',
      Models: '/dashboard/models',
      Projects: '/dashboard/projects',
    });
  });
});

// ── Cost axis ticks ───────────────────────────────────────────────────────────

describe('compactCost', () => {
  it('keeps sub-cent ticks distinct instead of collapsing them to $0.000', () => {
    expect([0.0015, 0.003, 0.0045, 0.006].map(compactCost))
      .toEqual(['$0.0015', '$0.0030', '$0.0045', '$0.0060']);
  });

  it('formats zero, cents and thousands compactly', () => {
    expect(compactCost(0)).toBe('$0');
    expect(compactCost(0.5)).toBe('$0.50');
    expect(compactCost(12.5)).toBe('$12.50');
    expect(compactCost(2400)).toBe('$2.4k');
  });

  it('caps the decimals so a tick still fits the axis gutter', () => {
    expect(compactCost(0.00000001)).toBe('$0.000000');
  });
});
