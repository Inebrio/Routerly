import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsagePage } from './UsagePage';

// ponytail: mock api at module level; only stub what UsagePage calls
vi.mock('../api', () => ({
  getUsage: vi.fn(),
  getProjects: vi.fn(),
  getModels: vi.fn(),
}));

// Mock DateRangePicker and MultiSelect to avoid complex UI
vi.mock('../components/DateRangePicker', () => ({
  DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
  PRESETS: [],
  RECENT_PRESETS: [],
}));
vi.mock('../components/MultiSelect', () => ({
  MultiSelect: () => <div data-testid="multi-select" />,
}));
import { getUsage, getProjects, getModels } from '../api';

// useFilterState mock must be after imports so hoisting works
vi.mock('../hooks/useFilterState', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    useFilterState: ({ defaultValue }: { defaultValue: unknown }) =>
      react.useState(defaultValue),
  };
});

// Minimal valid UsageStats
function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      totalCost: 1.0,
      totalCalls: 10,
      successCalls: 9,
      errorCalls: 1,
      routingCalls: 2,
      completionCalls: 8,
      routingCost: 0.001,
      completionCost: 0.999,
      ...overrides,
    },
    byModel: {},
    timeline: [],
    records: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <UsagePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(getProjects).mockResolvedValue([]);
  vi.mocked(getModels).mockResolvedValue([]);
});

describe('UsagePage — no leaderboard tab', () => {
  it('does not render a Leaderboard tab', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Leaderboard' })).toBeNull());
  });
});

describe('UsagePage — per-model table enriched columns', () => {
  it('shows Provider, Success rate, Avg latency, P95 latency, Cost/1K headers', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'openai/gpt-4o': {
          calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0,
          cost: 0.01, errors: 0, success: 5, avgLatencyMs: 320, p95LatencyMs: 600,
        },
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Provider')).toBeTruthy();
      expect(screen.getByText('Success rate')).toBeTruthy();
      expect(screen.getByText('Avg latency')).toBeTruthy();
      expect(screen.getByText('P95 latency')).toBeTruthy();
      expect(screen.getByText('Cost / 1K')).toBeTruthy();
    });
  });

  it('renders provider from models list (slash id)', async () => {
    vi.mocked(getModels).mockResolvedValue([{ id: 'openai/gpt-4o', provider: 'openai', name: 'GPT-4o', endpoint: '', cost: { inputPerMillion: 0, outputPerMillion: 0 } }] as never);
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'openai/gpt-4o': {
          calls: 2, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
          cost: 0.001, errors: 0, success: 2, avgLatencyMs: 200, p95LatencyMs: 400,
        },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('openai')).toBeTruthy());
  });

  it('renders provider from models list for slash-less id (not the modelId itself)', async () => {
    vi.mocked(getModels).mockResolvedValue([{ id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', endpoint: '', cost: { inputPerMillion: 0, outputPerMillion: 0 } }] as never);
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'gpt-4o': {
          calls: 2, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
          cost: 0.001, errors: 0, success: 2, avgLatencyMs: 200, p95LatencyMs: 400,
        },
      },
    });
    renderPage();
    // must show 'openai' from the model registry, NOT the bare id 'gpt-4o'
    await waitFor(() => expect(screen.getByText('openai')).toBeTruthy());
    expect(screen.queryAllByText('gpt-4o').length).toBeLessThan(2); // appears in Model col only
  });

  it('renders star on best cost-per-1k model', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'openai/gpt-4o': {
          calls: 2, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0,
          cost: 0.001, errors: 0, success: 2, avgLatencyMs: 200, p95LatencyMs: 400,
        },
      },
    });
    renderPage();
    await waitFor(() => {
      const star = document.querySelector('[aria-label="Best cost-performance"]');
      expect(star).toBeTruthy();
    });
  });
});

describe('UsagePage — guardrail stat card', () => {
  it('does NOT show guardrail card when guardrailCalls is 0', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ guardrailCalls: 0, guardrailCost: 0 }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('Guardrail Calls')).toBeNull());
  });

  it('does NOT show guardrail card when guardrailCalls is undefined', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.queryByText('Guardrail Calls')).toBeNull());
  });

  it('shows guardrail card when guardrailCalls > 0', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ guardrailCalls: 3, guardrailCost: 0.0001 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Guardrail Calls')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy();
  });
});

describe('UsagePage — Guardrail filter button', () => {
  it('renders Completion/Router/Guardrail filter buttons in the Type group', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Completion' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Router' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Guardrail' })).toBeTruthy();
    });
  });

  it('clicking Guardrail button marks it active (btn-primary)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Guardrail' });
    await userEvent.click(btn);
    expect(btn.className).toContain('btn-primary');
  });
});

describe('UsagePage — blocked outcome', () => {
  function makeStatsWithRecord(outcomeVal: string) {
    return {
      summary: { totalCost: 1, totalCalls: 1, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 1, routingCost: 0, completionCost: 1 },
      byModel: {},
      timeline: [],
      records: [{
        id: 'r1', timestamp: new Date().toISOString(), projectId: 'p1', modelId: 'openai/gpt-4o',
        inputTokens: 10, outputTokens: 5, cost: 0.001, latencyMs: 500, outcome: outcomeVal,
      }],
    };
  }

  it('blocked outcome badge uses badge-warning not badge-error', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecord('blocked'));
    renderPage();
    await waitFor(() => {
      const badge = document.querySelector('.badge-warning');
      expect(badge).toBeTruthy();
      expect(document.querySelector('.badge-error')).toBeNull();
    });
  });

  it('error outcome badge uses badge-error', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecord('error'));
    renderPage();
    await waitFor(() => expect(document.querySelector('.badge-error')).toBeTruthy());
  });

  it('renders Blocked filter button in Status group', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Blocked' })).toBeTruthy());
  });
});

describe('UsagePage — blockedCalls stat card', () => {
  it('does NOT show Blocked Calls card when blockedCalls is 0', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ blockedCalls: 0 }));
    renderPage();
    await waitFor(() => expect(screen.queryByText('Blocked Calls')).toBeNull());
  });

  it('does NOT show Blocked Calls card when blockedCalls is undefined', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.queryByText('Blocked Calls')).toBeNull());
  });

  it('shows Blocked Calls card when blockedCalls > 0', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ blockedCalls: 5 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Blocked Calls')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
  });
});

describe('UsagePage — Rank column and sortable per-model table', () => {
  function makeByModel(overrides: Record<string, unknown> = {}) {
    return {
      'cheap-model': {
        calls: 10, inputTokens: 5000, outputTokens: 2000, cachedInputTokens: 0,
        cost: 0.001, errors: 0, success: 10, avgLatencyMs: 200, p95LatencyMs: 400,
        ...overrides,
      },
      'expensive-model': {
        calls: 10, inputTokens: 5000, outputTokens: 2000, cachedInputTokens: 0,
        cost: 0.05, errors: 0, success: 10, avgLatencyMs: 150, p95LatencyMs: 300,
      },
    };
  }

  it('renders a Rank column header', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => expect(screen.getByText('Rank')).toBeTruthy());
  });

  it('rank 1 is on the best cost-performance model (lowest costPer1k / successRate)', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => screen.getByText('Rank'));
    // cheap-model has lower cost, so should be rank 1 — star appears on it
    const star = document.querySelector('[aria-label="Best cost-performance"]');
    expect(star).toBeTruthy();
    const rankRow = star?.closest('tr');
    expect(rankRow?.textContent).toContain('cheap-model');
  });

  it('default sort is Rank ascending (rank 1 row appears first)', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => screen.getByText('Rank'));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('cheap-model');
  });

  it('re-sorting by Cost does not renumber Rank (rank values stay stable)', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => screen.getByText('Rank'));
    // click Cost header to re-sort
    const costHeader = screen.getByText('Cost (USD)');
    await userEvent.click(costHeader);
    // rows are now sorted by cost but Rank column value on cheap-model row is still 1
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const cheapRow = rows.find(r => r.textContent?.includes('cheap-model'));
    // first cell is Rank — should show 1 (or the star + 1)
    const rankCell = cheapRow?.querySelector('td:first-child');
    expect(rankCell?.textContent).toContain('1');
  });

  it('model with zero success gets rank — (Infinity, displays as dash)', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'zero-success': {
          calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0,
          cost: 0.01, errors: 5, success: 0, avgLatencyMs: 100, p95LatencyMs: 200,
        },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText('zero-success'));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const rankCell = rows[0]?.querySelector('td:first-child');
    // Infinity rank renders as a dash character
    expect(rankCell?.textContent?.trim()).toMatch(/^[—-]$/);
  });

  it('clicking Model header sorts alphabetically', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => screen.getAllByText('cheap-model'));
    // find the th>span that contains "Model" text (not the filter label)
    const modelTh = Array.from(document.querySelectorAll('th span')).find(
      el => el.textContent?.trim().startsWith('Model')
    );
    expect(modelTh).toBeTruthy();
    await userEvent.click(modelTh!); // asc: c before e
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('cheap-model');
  });

  it('clicking Calls header sorts numerically', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'few-calls': { calls: 2, inputTokens: 500, outputTokens: 200, cachedInputTokens: 0, cost: 0.001, errors: 0, success: 2, avgLatencyMs: 100, p95LatencyMs: 200 },
        'many-calls': { calls: 20, inputTokens: 5000, outputTokens: 2000, cachedInputTokens: 0, cost: 0.01, errors: 0, success: 20, avgLatencyMs: 150, p95LatencyMs: 300 },
      },
    });
    renderPage();
    await waitFor(() => screen.getByText('Calls'));
    const callsHeader = screen.getByText('Calls');
    await userEvent.click(callsHeader); // asc: few first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('few-calls');
  });

  it('clicking a header twice reverses sort direction', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => screen.getAllByText('cheap-model'));
    const modelTh = Array.from(document.querySelectorAll('th span')).find(
      el => el.textContent?.trim().startsWith('Model')
    );
    expect(modelTh).toBeTruthy();
    await userEvent.click(modelTh!); // asc
    await userEvent.click(modelTh!); // desc: e before c
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('expensive-model');
  });
});

describe('UsagePage — Live mode', () => {
  it('renders the Live button', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.getByText(/● Live/)).toBeTruthy());
  });

  it('LIVE indicator is visible on mount (liveMode defaults true)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.getByText('LIVE')).toBeTruthy());
  });

  it('toggling Live off hides the LIVE indicator', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText('LIVE'));
    const liveBtn = screen.getByText(/● Live/);
    await userEvent.click(liveBtn); // disable
    await waitFor(() => expect(screen.queryByText('LIVE')).toBeNull());
  });

  it('toggling Live off then on restores the LIVE indicator', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText('LIVE'));
    const liveBtn = screen.getByText(/● Live/);
    await userEvent.click(liveBtn); // disable
    await waitFor(() => expect(screen.queryByText('LIVE')).toBeNull());
    await userEvent.click(liveBtn); // re-enable
    await waitFor(() => expect(screen.getByText('LIVE')).toBeTruthy());
  });

  it('clicking a poll-interval button exits live mode and marks interval active', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText('LIVE'));
    const oneMinBtn = screen.getByRole('button', { name: '1m' });
    await userEvent.click(oneMinBtn); // exits live mode, selects 1m interval
    expect(oneMinBtn.className).toContain('btn-primary');
    // LIVE indicator disappears once live mode is off
    await waitFor(() => expect(screen.queryByText('LIVE')).toBeNull());
  });
});
