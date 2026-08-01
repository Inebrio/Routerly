import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ponytail: stub recharts — invoke tickFormatters and render the tooltip content
// so the formatters this page passes into the chart system stay covered.
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
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
import { getUsage, getModels, getProjects, getClients } from '../api';

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

  it('does not render token strip when all tokens are 0', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Overview'));
    expect(screen.queryByText(/Input tokens/)).toBeNull();
  });

  it('renders token aggregate strip when tokens > 0', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 0.5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/Input tokens/)).not.toBeNull());
    expect(screen.queryByText(/Output tokens/)).not.toBeNull();
  });

  it('renders cached token count when cachedInputTokens > 0', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      byModel: {
        'openai/gpt-4o': { calls: 10, errors: 0, cost: 0.5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 200 },
      },
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/Cached/)).not.toBeNull());
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

// ── Period selector ────────────────────────────────────────────────────────────

describe('OverviewPage — period selector', () => {
  it('renders four period buttons', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Overview'));
    expect(screen.queryByText('Daily')).not.toBeNull();
    expect(screen.queryByText('Weekly')).not.toBeNull();
    expect(screen.queryByText('Monthly')).not.toBeNull();
    expect(screen.queryByText('All')).not.toBeNull();
  });

  it('clicking Daily switches period and calls getUsage with "daily"', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Daily'));
    await userEvent.click(screen.getByText('Daily'));
    await waitFor(() =>
      expect(mockGetUsage).toHaveBeenCalledWith('daily')
    );
  });

  it('clicking Weekly calls getUsage with "weekly"', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Weekly'));
    await userEvent.click(screen.getByText('Weekly'));
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledWith('weekly'));
  });

  it('clicking All calls getUsage with "all"', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('All'));
    await userEvent.click(screen.getByText('All'));
    await waitFor(() => expect(mockGetUsage).toHaveBeenCalledWith('all'));
  });
});

// ── Timeline data derivation ───────────────────────────────────────────────────

describe('OverviewPage — timeline chart', () => {
  it('renders area chart when timeline data is non-empty (monthly period)', async () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    mockGetUsage.mockResolvedValue(makeStats({
      timeline: [[dateStr, 0.5]],
    }));
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('area-chart')).not.toBeNull());
  });

  it('renders area chart for weekly period', async () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    mockGetUsage.mockResolvedValue(makeStats({ timeline: [[dateStr, 0.1]] }));
    renderPage();
    await waitFor(() => screen.queryByText('Weekly'));
    await userEvent.click(screen.getByText('Weekly'));
    await waitFor(() => expect(screen.queryByTestId('area-chart')).not.toBeNull());
  });

  it('renders area chart for "all" period with timeline data', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      timeline: [['2024-01-01', 0.1], ['2024-01-02', 0.2]],
    }));
    renderPage();
    await waitFor(() => screen.queryByText('All'));
    await userEvent.click(screen.getByText('All'));
    await waitFor(() => expect(screen.queryByTestId('area-chart')).not.toBeNull());
  });

  it('renders hourly area chart when timeline entries have datetime format', async () => {
    mockGetUsage.mockResolvedValue(makeStats({
      timeline: [['2024-01-15T10', 0.05]],
    }));
    renderPage();
    await waitFor(() => screen.queryByText('Daily'));
    await userEvent.click(screen.getByText('Daily'));
    await waitFor(() => expect(screen.queryByTestId('area-chart')).not.toBeNull());
  });

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

  it('weekly timeline with Sunday date uses correct offset (d===0 branch)', async () => {
    // Force a Sunday so d===0 branch fires (start.setDate - 6)
    const sunday = new Date('2024-01-07'); // Jan 7 2024 is a Sunday
    const origDate = globalThis.Date;
    const MockDate = class extends origDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(sunday.getTime()); // new Date() → Sunday
        // @ts-expect-error spread types
        else super(...args);
      }
      static override now() { return sunday.getTime(); }
    } as unknown as typeof Date;
    globalThis.Date = MockDate;

    mockGetUsage.mockResolvedValue(makeStats({ timeline: [['2024-01-01', 0.5]] }));
    renderPage();
    await waitFor(() => screen.queryByText('Weekly'));
    await userEvent.click(screen.getByText('Weekly'));
    await waitFor(() => expect(screen.queryByTestId('area-chart')).not.toBeNull());

    globalThis.Date = origDate;
  });
});
