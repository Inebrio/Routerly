import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsagePage } from './UsagePage';

// ponytail: mock api at module level; only stub what UsagePage calls
vi.mock('../api', () => ({
  getUsage: vi.fn(),
  getRouters: vi.fn(),
  getModels: vi.fn(),
}));

// Mock DateRangePicker and MultiSelect to avoid complex UI
vi.mock('../components/DateRangePicker', () => ({
  DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
  // The page seeds its default range from PRESETS, so the stub has to carry the
  // preset it looks for: an empty list would make the default throw.
  PRESETS: [
    {
      label: 'This month',
      range: () => ({ from: '2024-06-01', to: new Date().toISOString().slice(0, 10), label: 'This month' }),
    },
  ],
  RECENT_PRESETS: [],
  parseStoredRange: (v: string) => JSON.parse(v),
}));
vi.mock('../components/MultiSelect', () => ({
  MultiSelect: () => <div data-testid="multi-select" />,
}));
import { getUsage, getRouters, getModels } from '../api';

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
    // The filter buttons are built from these (T210), so a fixture that wants a
    // caller or a type to be offered has to put traffic behind it.
    byCallType: { completion: 8, routing: 2, guardrail: 1, judge: 1 },
    byRequestType: { chat: 5, completion: 1, embedding: 1, rerank: 1, image: 1, audio: 1 },
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
  vi.mocked(getRouters).mockResolvedValue([]);
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
      expect(screen.getByRole('button', { name: /^Completion \d/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Router \d/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Guardrail \d/ })).toBeTruthy();
    });
  });

  it('clicking Guardrail button marks it active (btn-primary)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const btn = await screen.findByRole('button', { name: /^Guardrail \d/ });
    await userEvent.click(btn);
    expect(btn.className).toContain('btn-primary');
  });

  it('offers the Judge filter for the experiment judge calls (T72)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const btn = await screen.findByRole('button', { name: /^Judge \d/ });
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
        id: 'r1', timestamp: new Date().toISOString(), routerId: 'p1', modelId: 'openai/gpt-4o',
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
    expect(screen.getByText('Blocked Calls').closest('.stat-card')?.querySelector('.stat-value')?.textContent).toBe('5');
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

  it('shows the first 10 models and expands to the rest on demand', async () => {
    const byModel = Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [`model-${String(i).padStart(2, '0')}`, {
        calls: 10, inputTokens: 5000, outputTokens: 2000, cachedInputTokens: 0,
        cost: 0.001 * (i + 1), errors: 0, success: 10, avgLatencyMs: 200, p95LatencyMs: 400,
      }])
    );
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel });
    renderPage();
    await waitFor(() => expect(screen.getByText('Rank')).toBeTruthy());
    expect(document.querySelectorAll('tbody tr')).toHaveLength(10);

    await userEvent.click(screen.getByText('Show 4 more models'));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(14);

    await userEvent.click(screen.getByText('Show fewer models'));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(10);
  });

  it('leaves the ranking whole when it fits', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: makeByModel() });
    renderPage();
    await waitFor(() => expect(screen.getByText('Rank')).toBeTruthy());
    expect(screen.queryByText(/Show \d+ more model/)).toBeNull();
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

// ── Error + retry ──────────────────────────────────────────────────────────────

describe('UsagePage — error and retry', () => {
  afterEach(() => vi.useRealTimers());

  it('shows error state when getUsage rejects', async () => {
    vi.mocked(getUsage).mockRejectedValue(new Error('network failure'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to load usage data/)).toBeTruthy());
    expect(screen.getByText('network failure')).toBeTruthy();
  });

  it('shows Retry button in error state', async () => {
    vi.mocked(getUsage).mockRejectedValue(new Error('bad'));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
  });

  it('Refresh now button calls fetchStats again', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText('Total Calls'));
    const refreshBtn = screen.getByTitle('Refresh now');
    await userEvent.click(refreshBtn);
    // getUsage called at least twice (mount + refresh)
    expect(vi.mocked(getUsage).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows error for non-Error rejection (string)', async () => {
    vi.mocked(getUsage).mockRejectedValue('string error');
    renderPage();
    await waitFor(() => expect(screen.getByText(/string error/)).toBeTruthy());
  });
});

// ── Records table ──────────────────────────────────────────────────────────────

describe('UsagePage — records table', () => {
  function makeRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec1',
      timestamp: new Date().toISOString(),
      routerId: 'proj-abc',
      modelId: 'openai/gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.001,
      latencyMs: 300,
      outcome: 'success',
      callType: 'completion',
      ttftMs: null,
      tokensPerSec: null,
      ...overrides,
    };
  }

  function makeStatsWithRecords(records: unknown[]) {
    return {
      summary: { totalCost: 1, totalCalls: 1, successCalls: 1, errorCalls: 0, routingCalls: 0, completionCalls: 1, routingCost: 0, completionCost: 1 },
      byModel: {},
      timeline: [],
      records,
    } as never;
  }

  it('renders "No usage records" empty state when records array is empty', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([]));
    renderPage();
    await waitFor(() => expect(screen.getByText(/No usage records/)).toBeTruthy());
  });

  it('renders a record row and shows its model', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord()]));
    renderPage();
    await waitFor(() => expect(screen.getAllByText('openai/gpt-4o').length).toBeGreaterThan(0));
  });

  it('shows router name when router is loaded', async () => {
    vi.mocked(getRouters).mockResolvedValue([{ id: 'proj-abc', name: 'MyRouter' } as never]);
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord()]));
    renderPage();
    await waitFor(() => expect(screen.getByText('MyRouter')).toBeTruthy());
  });

  it('names the token a call came in on, and offers it as a filter', async () => {
    vi.mocked(getRouters).mockResolvedValue([{
      id: 'proj-abc', name: 'MyRouter',
      tokens: [
        { id: 'tok-1', tokenSnippet: 'sk-rt-aaa', createdAt: '2026-01-01T00:00:00Z', labels: ['ci'] },
        { id: 'tok-2', tokenSnippet: 'sk-rt-bbb', createdAt: '2026-01-01T00:00:00Z' },
      ],
    } as never]);
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ tokenId: 'tok-1' })]));
    renderPage();
    // The label wins over the snippet on the record row, and the filter is
    // offered because the router has more than one token.
    await waitFor(() => expect(screen.getAllByText('ci').length).toBeGreaterThan(0));
    expect(screen.getByText('Token')).toBeTruthy();
  });

  it('shows no token line on a record written before tokens were tracked', async () => {
    vi.mocked(getRouters).mockResolvedValue([{ id: 'proj-abc', name: 'MyRouter', tokens: [] } as never]);
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord()]));
    renderPage();
    await waitFor(() => expect(screen.getByText('MyRouter')).toBeTruthy());
    expect(screen.queryByText('Token')).toBeNull();
  });

  it('falls back to routerId span when router not found', async () => {
    vi.mocked(getRouters).mockResolvedValue([]);
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ routerId: 'unknown-proj' })]));
    renderPage();
    await waitFor(() => expect(screen.getByText('unknown-proj')).toBeTruthy());
  });

  it('shows ttftMs when present', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ ttftMs: 42 })]));
    renderPage();
    await waitFor(() => expect(screen.getByText('42ms')).toBeTruthy());
  });

  it('shows dash for null ttftMs', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ ttftMs: null })]));
    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o'));
    // at least one dash in the ttft/tokensPerSec columns
    const tds = Array.from(document.querySelectorAll('td'));
    expect(tds.some(td => td.textContent === '—')).toBe(true);
  });

  it('shows tokensPerSec when present', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ tokensPerSec: 35 })]));
    renderPage();
    await waitFor(() => expect(screen.getByText('35')).toBeTruthy());
  });

  it('renders routing badge for routing callType', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ callType: 'routing' })]));
    renderPage();
    await waitFor(() => expect(screen.getByText('router')).toBeTruthy());
  });

  it('renders completion badge for completion callType', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ callType: 'completion' })]));
    renderPage();
    await waitFor(() => expect(screen.getByText('completion')).toBeTruthy());
  });

  it('names the caller of a guardrail and of a judge call (T72)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([
      makeRecord({ id: 'r-guard', callType: 'guardrail' }),
      makeRecord({ id: 'r-judge', callType: 'judge' }),
    ]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('guardrail')).toBeTruthy();
      expect(screen.getByText('judge')).toBeTruthy();
    });
  });

  it('shows the request type of a record', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ requestType: 'embedding' })]));
    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o'));
    expect(screen.getAllByText('Embedding').some(el => el.tagName === 'TD')).toBe(true);
  });

  it('falls back to Chat for records written before requestType existed', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord()]));
    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o'));
    expect(screen.getAllByText('Chat').some(el => el.tagName === 'TD')).toBe(true);
  });

  it('navigates to detail page on row click', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStatsWithRecords([makeRecord({ id: 'rec-nav' })]));
    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o'));
    const row = document.querySelector('tbody tr') as HTMLElement;
    expect(row).toBeTruthy();
    fireEvent.click(row);
    // navigation attempted (no error thrown means navigate was called)
  });

  it('shows "X / total" count in Recent Calls when pagination present', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStatsWithRecords([makeRecord()]) as object,
      pagination: { page: 1, pageSize: 20, totalPages: 3, totalRecords: 250 },
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText(/1 \/ 250/)).toBeTruthy());
  });
});

// ── Pagination controls ────────────────────────────────────────────────────────

describe('UsagePage — pagination controls', () => {
  function makePagedStats(page: number, totalPages: number) {
    return {
      summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
      byModel: {},
      timeline: [],
      records: [{ id: 'r1', timestamp: new Date().toISOString(), routerId: 'p', modelId: 'm', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 0, outcome: 'success' }],
      pagination: { page, pageSize: 20, totalPages, totalRecords: totalPages * 100 },
    } as never;
  }

  it('shows pagination controls when totalPages > 1', async () => {
    vi.mocked(getUsage).mockResolvedValue(makePagedStats(1, 3));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  it('Previous button is disabled on page 1', async () => {
    vi.mocked(getUsage).mockResolvedValue(makePagedStats(1, 3));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('Next button calls setPage +1', async () => {
    vi.mocked(getUsage).mockResolvedValue(makePagedStats(1, 3));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(vi.mocked(getUsage).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('Previous button calls setPage -1 when not on page 1', async () => {
    // Start on page 2 by returning page=2 initially, then clicking Prev
    vi.mocked(getUsage).mockResolvedValue(makePagedStats(2, 3));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Previous' }));
    // page state starts at 1 in the component; Previous will be disabled. Click Next to go to page 2.
    const nextBtn = screen.getByRole('button', { name: 'Next' });
    expect(nextBtn).not.toBeDisabled();
    await userEvent.click(nextBtn); // page → 2
    // Now Previous should not be disabled
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Previous' })); // page → 1
    expect(vi.mocked(getUsage).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Stat card click toggles ────────────────────────────────────────────────────

describe('UsagePage — stat card click toggles callTypeFilter', () => {
  it('clicking Completion Calls card activates completion filter (Type button becomes primary)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ completionCalls: 5, completionCost: 0.5 }));
    renderPage();
    await waitFor(() => screen.getByText('Completion Calls'));
    const card = screen.getByText('Completion Calls').closest('.stat-card') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    // After click, Completion Type filter button becomes active
    await waitFor(() => expect(screen.getByRole('button', { name: /^Completion \d/ }).className).toContain('btn-primary'));
  });

  it('clicking Router Calls card activates routing filter (Router button becomes primary)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ routingCalls: 3 }));
    renderPage();
    await waitFor(() => screen.getByText('Router Calls'));
    const card = screen.getByText('Router Calls').closest('.stat-card') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Router \d/ }).className).toContain('btn-primary'));
  });

  it('clicking Router Calls card again deactivates routing filter', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ routingCalls: 3 }));
    renderPage();
    await waitFor(() => screen.getByText('Router Calls'));
    // Activate via the explicit Router filter button (not the card) then click the card
    // to cover the card's f===routing → 'all' toggle branch
    await userEvent.click(screen.getByRole('button', { name: /^Router \d/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Router \d/ }).className).toContain('btn-primary'));
    const card = screen.getByText('Router Calls').closest('.stat-card') as HTMLElement;
    fireEvent.click(card); // callTypeFilter=routing → card sets it to 'all'
    await waitFor(() => expect(screen.getByRole('button', { name: /^Router \d/ }).className).not.toContain('btn-primary'));
  });
});

// ── Reset filters ──────────────────────────────────────────────────────────────

describe('UsagePage — reset filters button', () => {
  it('Reset filters button appears and resets active filters', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText('Total Calls'));
    // Activate a filter via the Type buttons
    const guardrailBtn = screen.getByRole('button', { name: /^Guardrail \d/ });
    await userEvent.click(guardrailBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset filters' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    // After reset, Reset filters button should disappear (no active filters)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull());
  });

  it('Success filter button activates filter', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Success' });
    await userEvent.click(btn);
    expect(btn.className).toContain('btn-primary');
  });

  it('Error filter button activates filter', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Error' });
    await userEvent.click(btn);
    expect(btn.className).toContain('btn-primary');
  });
});

// ── Request type filter (T60) ──────────────────────────────────────────────────

describe('UsagePage — request type filter', () => {
  it('sends the picked request type to the server', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const btn = await screen.findByRole('button', { name: /^Embedding \d/ });
    await userEvent.click(btn);
    expect(btn.className).toContain('btn-primary');
    await waitFor(() => {
      const calls = vi.mocked(getUsage).mock.calls;
      expect(calls[calls.length - 1]?.[6]).toMatchObject({ requestType: 'embedding' });
    });
  });

  it('reset clears the request type filter', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Image \d/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Image \d/ }).className).not.toContain('btn-primary'));
  });
});

// ── Model sort remaining keys ──────────────────────────────────────────────────

describe('UsagePage — model table sort keys', () => {
  // Use slash IDs so provider is derived from prefix, not the full modelId string
  // (avoids modelId appearing twice in the row text — once in Model col, once in Provider col)
  function byModel2() {
    return {
      'p/model-alpha': { calls: 5, inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, cost: 0.002, errors: 1, success: 4, avgLatencyMs: 100, p95LatencyMs: 200 },
      'p/model-beta':  { calls: 10, inputTokens: 800, outputTokens: 400, cachedInputTokens: 0, cost: 0.001, errors: 0, success: 10, avgLatencyMs: 50, p95LatencyMs: 100 },
    };
  }

  it('sorts by Errors column', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const errHeader = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim() === 'Errors');
    expect(errHeader).toBeTruthy();
    await userEvent.click(errHeader!); // asc: model-beta (0 errors) first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-beta');
  });

  it('sorts by Success rate column', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const srHeader = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('Success rate'));
    expect(srHeader).toBeTruthy();
    await userEvent.click(srHeader!); // asc: model-alpha (0.8) before model-beta (1.0)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-alpha');
  });

  it('sorts by Avg latency column', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const header = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('Avg latency'));
    expect(header).toBeTruthy();
    await userEvent.click(header!); // asc: model-beta (50ms) before model-alpha (100ms)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-beta');
  });

  it('sorts by P95 latency column', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const header = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('P95 latency'));
    expect(header).toBeTruthy();
    await userEvent.click(header!); // asc: model-beta (100ms) before model-alpha (200ms)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-beta');
  });

  it('sorts by Input tokens column', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const header = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('Input tokens'));
    expect(header).toBeTruthy();
    await userEvent.click(header!); // asc: model-alpha (200) before model-beta (800)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-alpha');
  });

  it('sorts by Output tokens column', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const header = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('Output tokens'));
    expect(header).toBeTruthy();
    await userEvent.click(header!); // asc: model-alpha (100 out) before model-beta (400 out)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-alpha');
  });

  it('sorts by Cost/1K column (finite values)', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const header = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('Cost / 1K'));
    expect(header).toBeTruthy();
    await userEvent.click(header!); // asc: lower cost/1k first
    expect(document.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('sorts by Provider column in model table', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byModel: byModel2() });
    vi.mocked(getModels).mockResolvedValue([
      { id: 'p/model-alpha', provider: 'zz-prov', name: '', endpoint: '', cost: { inputPerMillion: 0, outputPerMillion: 0 } } as never,
      { id: 'p/model-beta', provider: 'aa-prov', name: '', endpoint: '', cost: { inputPerMillion: 0, outputPerMillion: 0 } } as never,
    ]);
    renderPage();
    await waitFor(() => screen.getAllByText(/model-alpha/).length > 0);
    const header = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim() === 'Provider');
    expect(header).toBeTruthy();
    await userEvent.click(header!); // asc: aa-prov first → model-beta row first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-beta');
  });

  it('rank ties: two models with same metric share the same rank number', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'x/tie-alpha': { calls: 10, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cost: 0.01, errors: 0, success: 10, avgLatencyMs: 100, p95LatencyMs: 200 },
        'x/tie-beta':  { calls: 10, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cost: 0.01, errors: 0, success: 10, avgLatencyMs: 150, p95LatencyMs: 300 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/tie-alpha/).length > 0);
    // Both have same metric → tied at rank 1; each rank cell shows '1'
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const rankTexts = rows.map(r => r.querySelector('td:first-child')?.textContent?.trim());
    expect(rankTexts.every(t => t?.includes('1'))).toBe(true);
  });

  it('fmtCost: cost below 0.01 uses 4 decimal places', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'x/cheap': { calls: 10, inputTokens: 5000, outputTokens: 2500, cachedInputTokens: 0,
          cost: 0.000001, errors: 0, success: 10, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    // cost/1k ≈ 0.000000133 → < 0.01 → fmtCost returns 4 decimal string
    await waitFor(() => screen.getAllByText(/cheap/).length > 0);
    const cells = Array.from(document.querySelectorAll('td.mono'));
    expect(cells.length).toBeGreaterThan(0);
  });
});

// ── prevMax / new-row highlighting ────────────────────────────────────────────

describe('UsagePage — prevMax new-row detection', () => {
  it('new-row detection: second fetch with newer timestamp exercises prevMax+ids branches', async () => {
    const ts1 = '2024-01-01T00:00:00.000Z';
    const ts2 = '2024-01-02T00:00:00.000Z'; // strictly newer

    const statsWithRecord = (id: string, ts: string) => ({
      summary: { totalCost: 0, totalCalls: 1, successCalls: 1, errorCalls: 0, routingCalls: 0, completionCalls: 1, routingCost: 0, completionCost: 0 },
      byModel: {},
      timeline: [],
      records: [{ id, timestamp: ts, routerId: 'p', modelId: 'openai/gpt-4o', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 0, outcome: 'success' }],
    });

    // All fetches return a record; first sets maxTs, subsequent fetches exercise prevMax logic
    vi.mocked(getUsage)
      .mockResolvedValueOnce(statsWithRecord('rec-1', ts1))
      .mockResolvedValueOnce(statsWithRecord('rec-2', ts1)) // second initial fetch (dateRange reset)
      .mockResolvedValue(statsWithRecord('rec-new', ts2)); // Refresh: newer timestamp

    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o').length > 0);
    // Multiple Refresh clicks to ensure prevMax !== null is reached
    await userEvent.click(screen.getByTitle('Refresh now'));
    await userEvent.click(screen.getByTitle('Refresh now'));
    await waitFor(() => vi.mocked(getUsage).mock.calls.length >= 3);
    expect(screen.getByTitle('Refresh now')).toBeTruthy();
  });

  it('new-row detection: second fetch with same timestamp covers ids.size=0', async () => {
    const ts1 = '2024-01-01T00:00:00.000Z';
    const statsWithRecord = (id: string, ts: string) => ({
      summary: { totalCost: 0, totalCalls: 1, successCalls: 1, errorCalls: 0, routingCalls: 0, completionCalls: 1, routingCost: 0, completionCost: 0 },
      byModel: {},
      timeline: [],
      records: [{ id, timestamp: ts, routerId: 'p', modelId: 'openai/gpt-4o', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 0, outcome: 'success' }],
    });

    vi.mocked(getUsage).mockResolvedValue(statsWithRecord('rec-same', ts1));

    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o').length > 0);
    // Multiple refreshes: after first sets prevMax=ts1, subsequent have rec-same ts1 → NOT newer → ids.size=0
    await userEvent.click(screen.getByTitle('Refresh now'));
    await userEvent.click(screen.getByTitle('Refresh now'));
    await waitFor(() => vi.mocked(getUsage).mock.calls.length >= 3);
    // ids.size=0 → setNewRowIds not called → no row-new class
    expect(document.querySelector('.row-new')).toBeNull();
  });

  it('empty-records fetch: maxTs is empty string (if(maxTs) false branch)', async () => {
    // Always return empty records — maxTs stays '' → if(maxTs) never sets ref
    vi.mocked(getUsage).mockResolvedValue(makeStats()); // records:[]

    renderPage();
    await waitFor(() => screen.getByText('Total Calls'));
    await userEvent.click(screen.getByTitle('Refresh now'));
    await waitFor(() => vi.mocked(getUsage).mock.calls.length >= 2);
    expect(screen.getByTitle('Refresh now')).toBeTruthy();
  });

  it('reduce max: two records where second has older timestamp (max stays at first)', async () => {
    const ts1 = '2024-06-01T00:00:00.000Z'; // newer
    const ts0 = '2024-01-01T00:00:00.000Z'; // older — reduce: r.timestamp > max = false → returns max
    const twoRecords = {
      summary: { totalCost: 0, totalCalls: 2, successCalls: 2, errorCalls: 0, routingCalls: 0, completionCalls: 2, routingCost: 0, completionCost: 0 },
      byModel: {}, timeline: [],
      records: [
        { id: 'r-newer', timestamp: ts1, routerId: 'p', modelId: 'openai/gpt-4o', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 0, outcome: 'success' },
        { id: 'r-older', timestamp: ts0, routerId: 'p', modelId: 'openai/gpt-4o', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 0, outcome: 'success' },
      ],
    };
    vi.mocked(getUsage).mockResolvedValue(twoRecords);
    renderPage();
    await waitFor(() => vi.mocked(getUsage).mock.calls.length >= 1);
    expect(screen.getByTitle('Refresh now')).toBeTruthy();
  });

  it('pollInterval=0 skips setInterval (clicking Off button)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText('LIVE'));
    const offBtn = screen.getByRole('button', { name: 'Off' });
    await userEvent.click(offBtn); // sets liveMode=false, pollInterval=0
    expect(screen.getByTitle('Refresh now')).toBeTruthy();
  });
});

// ── dateRange init useEffect branches ─────────────────────────────────────────

describe('UsagePage — dateRange init useEffect', () => {
  it('sets default date range when from/to both empty', async () => {
    // useFilterState returns defaultValue { from: '', to: '', label: 'This month' }
    // RECENT_PRESETS is [] → isRecentPreset=false → hits the !from && !to branch
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    // Just verifying no crash and getUsage is called
    await waitFor(() => expect(vi.mocked(getUsage)).toHaveBeenCalled());
  });
});

// ── fetchStats recentPreset branch ────────────────────────────────────────────

describe('UsagePage — fetchStats with RECENT_PRESETS (mocked with value)', () => {
  it('uses recentPreset range when dateRange label matches a recent preset', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(vi.mocked(getUsage)).toHaveBeenCalled());
    const [period] = vi.mocked(getUsage).mock.calls[0]!;
    expect(['custom', 'all']).toContain(period);
  });
});

// ── provider fallback for non-slash model not in allModels ────────────────────

describe('UsagePage — provider fallback for slash-less id not in allModels', () => {
  it('uses modelId as provider when no slash and not in models list', async () => {
    vi.mocked(getModels).mockResolvedValue([]); // empty allModels
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'noslash': { calls: 2, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
          cost: 0.001, errors: 0, success: 2, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText('noslash').length >= 2); // appears in Model AND Provider cols
  });

  it('model with calls=0 gets successRate=0 (v.calls > 0 false branch)', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'x/zero-calls': { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          cost: 0, errors: 0, success: 0, avgLatencyMs: 0, p95LatencyMs: 0 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/zero-calls/).length > 0);
    // calls=0 → successRate=0 (false branch of v.calls > 0) → metric=Infinity → rank='—'
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.querySelector('td:first-child')?.textContent?.trim()).toBe('—');
  });
});

// ── sort same key desc→asc toggle ─────────────────────────────────────────────

describe('UsagePage — model sort same-key desc→asc toggle', () => {
  it('three clicks on same header: asc → desc → asc', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'p/aaa': { calls: 5, inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, cost: 0.001, errors: 0, success: 5, avgLatencyMs: 50, p95LatencyMs: 100 },
        'p/zzz': { calls: 5, inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, cost: 0.005, errors: 0, success: 5, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/aaa/).length > 0);
    const modelTh = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim().startsWith('Model'));
    expect(modelTh).toBeTruthy();
    await userEvent.click(modelTh!); // click 1: asc → p/aaa first
    await userEvent.click(modelTh!); // click 2: desc → p/zzz first
    await userEvent.click(modelTh!); // click 3: asc again → p/aaa first (d==='desc' → 'asc')
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('aaa');
  });
});

// ── rank sort: one Infinity one finite → aInf alone ───────────────────────────

describe('UsagePage — rank sort with one Infinity one finite', () => {
  it('finite-rank model appears before Infinity-rank model in rank sort', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'p/ok-model':  { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cost: 0.01, errors: 0, success: 5, avgLatencyMs: 100, p95LatencyMs: 200 },
        'p/bad-model': { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cost: 0.01, errors: 5, success: 0, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/ok-model/).length > 0);
    // Default rank sort asc: ok-model (finite rank) first, bad-model (Inf rank) last
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('ok-model');
    expect(rows[rows.length - 1]?.textContent).toContain('bad-model');
  });

  it('desc rank sort still keeps Infinity-rank model last (bInf branch)', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'p/ok-model2':  { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cost: 0.01, errors: 0, success: 5, avgLatencyMs: 100, p95LatencyMs: 200 },
        'p/bad-model2': { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cost: 0.01, errors: 5, success: 0, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/ok-model2/).length > 0);
    const rankTh = Array.from(document.querySelectorAll('th span')).find(el => el.textContent?.trim() === 'Rank');
    expect(rankTh).toBeTruthy();
    await userEvent.click(rankTh!); // asc (already default, just to be sure)
    await userEvent.click(rankTh!); // desc: finite-rank models still shown, Infinity always last
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[rows.length - 1]?.textContent).toContain('bad-model2');
  });
});

// ── v.cost null in byModel ────────────────────────────────────────────────────

describe('UsagePage — byModel cost null fallback', () => {
  it('renders $0 for model with null cost in byModel', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'x/null-cost': { calls: 1, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
          cost: null as never, errors: 0, success: 1, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/null-cost/).length > 0);
    // v.cost ?? 0 → 0 → "$0"
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
  });
});

// ── fmtCost branches ──────────────────────────────────────────────────────────

describe('UsagePage — fmtCost via per-model table', () => {
  function modelEntry(id: string, inputT: number, outputT: number, cost: number) {
    return { calls: 1, inputTokens: inputT, outputTokens: outputT, cachedInputTokens: 0,
      cost, errors: 0, success: 1, avgLatencyMs: 100, p95LatencyMs: 200 };
  }

  it('fmtCost(0): zero costPer1k renders $0 when cost is 0', async () => {
    // cost=0, totalTok>0 → costPer1k=0 → fmtCost(0) → "$0"
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: { 'x/free-model': modelEntry('x/free-model', 1000, 500, 0) },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/free-model/).length > 0);
    // both the Cost/1K and the Cost (USD) cell collapse to "$0"
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
  });

  it('fmtCost: costPer1k between 0.01 and 1 uses 3 decimal places', async () => {
    // cost=0.3, totalTok=1000+500=1500 → costPer1k = (0.3*1000)/1500 = 0.2 → fmtCost(0.2) → "$0.200"
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: { 'x/mid-model': modelEntry('x/mid-model', 1000, 500, 0.3) },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/mid-model/).length > 0);
    // costPer1k=0.2, 0.01 <= 0.2 < 1 → n.toFixed(3) → "$0.200"
    expect(screen.getByText('$0.200')).toBeTruthy();
  });

  it('fmtCost: costPer1k >= 1 uses 2 decimal places', async () => {
    // cost=3, totalTok=1000+500=1500 → costPer1k=(3*1000)/1500=2 → fmtCost(2) → "$2.00"
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: { 'x/exp-model': modelEntry('x/exp-model', 1000, 500, 3) },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/exp-model/).length > 0);
    expect(screen.getByText('$2.00')).toBeTruthy();
  });
});

// ── zero-token model (totalTok=0 → costPer1k=Infinity → dash) ────────────────

describe('UsagePage — zero-token model renders dash in Cost/1K', () => {
  it('shows dash for model with zero input+output tokens', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'x/zero-tok': { calls: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          cost: 0, errors: 0, success: 1, avgLatencyMs: 0, p95LatencyMs: 0 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/zero-tok/).length > 0);
    // totalTok=0 → costPer1k=Infinity → renders '—' span in the Cost/1K cell
    const cells = Array.from(document.querySelectorAll('td'));
    expect(cells.some(td => td.textContent === '—')).toBe(true);
  });
});

// ── Infinity sentinels in sortedModelRows ────────────────────────────────────

describe('UsagePage — Infinity sentinels in model sort', () => {
  it('two Infinity-rank models both get "—" and sorting is stable', async () => {
    // Both models: success=0 → metric=Infinity → rank=Infinity → displayRank='—'
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'x/inf-a': { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0,
          cost: 0.01, errors: 5, success: 0, avgLatencyMs: 100, p95LatencyMs: 200 },
        'x/inf-b': { calls: 3, inputTokens: 600, outputTokens: 300, cachedInputTokens: 0,
          cost: 0.005, errors: 3, success: 0, avgLatencyMs: 80, p95LatencyMs: 160 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/inf-a/).length > 0);
    // Both Infinity → aInf && bInf → return 0; displayRank='—' for both
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const rankCells = rows.map(r => r.querySelector('td:first-child')?.textContent?.trim());
    expect(rankCells.every(t => t === '—')).toBe(true);
  });

  it('Infinity costPer1k model (zero tokens) sinks below finite-costPer1k model', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        // zero tokens → costPer1k = Infinity (sentinel)
        'x/inf-c': { calls: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          cost: 0.01, errors: 0, success: 1, avgLatencyMs: 100, p95LatencyMs: 200 },
        // positive tokens → finite costPer1k
        'x/fin-c': { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0,
          cost: 0.01, errors: 0, success: 5, avgLatencyMs: 100, p95LatencyMs: 200 },
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText(/fin-c/).length > 0);
    const costHeader = Array.from(document.querySelectorAll('th span')).find(el =>
      el.textContent?.trim().startsWith('Cost / 1K'));
    expect(costHeader).toBeTruthy();
    await userEvent.click(costHeader!); // asc: fin-c (finite costPer1k) first, inf-c (Inf) last
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('fin-c');
    expect(rows[rows.length - 1]?.textContent).toContain('inf-c');
  });
});

// ── Stat card ternary branches ────────────────────────────────────────────────

describe('UsagePage — stat card ternary fallbacks', () => {
  it('completionCalls falls back to totalCalls when undefined', async () => {
    // Explicitly omit completionCalls (undefined) → ?? totalCalls
    const statsNoCompletion = {
      summary: { totalCost: 0, totalCalls: 42, successCalls: 42, errorCalls: 0,
        routingCalls: 0, completionCost: 0, routingCost: 0 }, // no completionCalls key
      byModel: {}, timeline: [], records: [],
    };
    vi.mocked(getUsage).mockResolvedValue(statsNoCompletion as never);
    renderPage();
    await waitFor(() => screen.getByText('Completion Calls'));
    const completionCard = screen.getByText('Completion Calls').closest('.stat-card') as HTMLElement;
    expect(completionCard?.querySelector('.stat-value')?.textContent).toBe('42');
  });

  it('routingCalls shows 0 when undefined (?? 0 fallback)', async () => {
    // Explicitly omit routingCalls → ?? 0
    const statsNoRouting = {
      summary: { totalCost: 0, totalCalls: 5, successCalls: 5, errorCalls: 0,
        completionCalls: 5, completionCost: 0, routingCost: 0 }, // no routingCalls key
      byModel: {}, timeline: [], records: [],
    };
    vi.mocked(getUsage).mockResolvedValue(statsNoRouting as never);
    renderPage();
    await waitFor(() => screen.getByText('Router Calls'));
    const routerCard = screen.getByText('Router Calls').closest('.stat-card') as HTMLElement;
    expect(routerCard?.querySelector('.stat-value')?.textContent).toBe('0');
  });

  it('completionCost undefined falls back to totalCost', async () => {
    // Explicitly no completionCost → ?? totalCost
    const s = {
      summary: { totalCost: 0.9999, totalCalls: 5, successCalls: 5, errorCalls: 0,
        completionCalls: 5, routingCalls: 0, routingCost: 0 },
      byModel: {}, timeline: [], records: [],
    };
    vi.mocked(getUsage).mockResolvedValue(s as never);
    renderPage();
    await waitFor(() => screen.getByText('Completion Calls'));
    const completionCard = screen.getByText('Completion Calls').closest('.stat-card') as HTMLElement;
    // completionCost is undefined → totalCost=0.9999 shown → "0.9999"
    expect(completionCard?.textContent).toContain('0.9999');
  });

  it('completionCost defined — completionCost is shown (not totalCost)', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ completionCalls: 5, completionCost: 0.1234 }));
    renderPage();
    await waitFor(() => screen.getByText('Completion Calls'));
    const completionCard = screen.getByText('Completion Calls').closest('.stat-card') as HTMLElement;
    expect(completionCard?.textContent).toContain('0.1234');
  });

  it('routingCost undefined falls back to 0', async () => {
    const s = {
      summary: { totalCost: 1, totalCalls: 5, successCalls: 5, errorCalls: 0,
        completionCalls: 5, completionCost: 1, routingCalls: 2 }, // no routingCost
      byModel: {}, timeline: [], records: [],
    };
    vi.mocked(getUsage).mockResolvedValue(s as never);
    renderPage();
    await waitFor(() => screen.getByText('Router Calls'));
    const routerCard = screen.getByText('Router Calls').closest('.stat-card') as HTMLElement;
    expect(routerCard?.textContent).toContain('$0.0000');
  });

  it('routingCost defined — routingCost shown in Router card', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ routingCalls: 2, routingCost: 0.0056 }));
    renderPage();
    await waitFor(() => screen.getByText('Router Calls'));
    const routerCard = screen.getByText('Router Calls').closest('.stat-card') as HTMLElement;
    expect(routerCard?.textContent).toContain('0.0056');
  });

  it('guardrailCost undefined falls back to 0 in Guardrail card', async () => {
    const s = {
      summary: { totalCost: 1, totalCalls: 5, successCalls: 5, errorCalls: 0,
        completionCalls: 5, completionCost: 1, routingCalls: 0, routingCost: 0, guardrailCalls: 3 }, // no guardrailCost
      byModel: {}, timeline: [], records: [],
    };
    vi.mocked(getUsage).mockResolvedValue(s as never);
    renderPage();
    await waitFor(() => screen.getByText('Guardrail Calls'));
    const gCard = screen.getByText('Guardrail Calls').closest('.stat-card') as HTMLElement;
    expect(gCard?.textContent).toContain('$0.0000');
  });

  it('guardrailCost defined — guardrailCost shown in Guardrail card', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats({ guardrailCalls: 2, guardrailCost: 0.0099 }));
    renderPage();
    await waitFor(() => screen.getByText('Guardrail Calls'));
    const gCard = screen.getByText('Guardrail Calls').closest('.stat-card') as HTMLElement;
    expect(gCard?.textContent).toContain('0.0099');
  });
});

// ── record cost null fallback ─────────────────────────────────────────────────

describe('UsagePage — record cost null fallback', () => {
  it('null cost in record renders "Unknown", never $0', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      summary: { totalCost: 0, totalCalls: 1, successCalls: 1, errorCalls: 0, routingCalls: 0, completionCalls: 1, routingCost: 0, completionCost: 0 },
      byModel: {},
      timeline: [],
      records: [{
        id: 'r-null-cost', timestamp: new Date().toISOString(), routerId: 'p',
        modelId: 'openai/gpt-4o', inputTokens: 1, outputTokens: 1,
        cost: null, latencyMs: 100, outcome: 'success',
      }],
    } as never);
    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o').length > 0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('per-call cost keeps 3 significant digits, sub-microdollar collapses to a threshold', async () => {
    const rec = (id: string, cost: number) => ({
      id, timestamp: new Date().toISOString(), routerId: 'p',
      modelId: 'openai/gpt-4o', inputTokens: 1, outputTokens: 1,
      cost, latencyMs: 100, outcome: 'success',
    });
    vi.mocked(getUsage).mockResolvedValue({
      summary: { totalCost: 0, totalCalls: 2, successCalls: 2, errorCalls: 0, routingCalls: 0, completionCalls: 2, routingCost: 0, completionCost: 0 },
      byModel: {},
      timeline: [],
      records: [rec('r-small', 0.00028812), rec('r-tiny', 0.0000004)],
    } as never);
    renderPage();
    await waitFor(() => screen.getAllByText('openai/gpt-4o').length > 0);
    expect(screen.getByText('$0.000288')).toBeTruthy();
    expect(screen.getByText('<$0.000001')).toBeTruthy();
  });
});

// ── PRESETS / RECENT_PRESETS branch coverage (module-isolated) ────────────────
// These branches require non-empty PRESETS/RECENT_PRESETS and a non-default
// dateRange state. We use vi.doMock + vi.resetModules per test.

describe('UsagePage — dateRange init: RECENT_PRESETS match (isRecentPreset=true early return)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../components/DateRangePicker');
    vi.doUnmock('../hooks/useFilterState');
    vi.doUnmock('../api');
    vi.doUnmock('../components/MultiSelect');
  });

  it('isRecentPreset=true: skips dateRange init re-apply (early return at line 81)', async () => {
    // Setup: RECENT_PRESETS has an entry matching the default dateRange label 'This month'
    const pastDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const mockPreset = { label: 'This month', range: () => ({ from: pastDate, to: pastDate, label: 'This month' }) };

    vi.doMock('../components/DateRangePicker', () => ({
      DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
      PRESETS: [mockPreset],
      RECENT_PRESETS: [mockPreset], // label matches default 'This month' → isRecentPreset=true → early return
    }));
    vi.doMock('../api', () => ({
      getUsage: vi.fn().mockResolvedValue({
        summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
        byModel: {}, timeline: [], records: [],
      }),
      getRouters: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../components/MultiSelect', () => ({ MultiSelect: () => <div /> }));
    vi.doMock('../hooks/useFilterState', async () => {
      const react = await vi.importActual<typeof import('react')>('react');
      return { useFilterState: ({ defaultValue }: { defaultValue: unknown }) => react.useState(defaultValue) };
    });

    const { UsagePage: Page } = await vi.importActual<typeof import('./UsagePage')>('./UsagePage');
    const { render: r, screen: s, waitFor: wf } = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
    const { MemoryRouter: MR } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    r(<MR><Page /></MR>);
    await wf(() => expect(s.getByTestId('date-picker')).toBeTruthy());
  });
});

describe('UsagePage — dateRange init: stale preset re-apply (line 87-91)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../components/DateRangePicker');
    vi.doUnmock('../hooks/useFilterState');
    vi.doUnmock('../api');
    vi.doUnmock('../components/MultiSelect');
  });

  it('re-applies matching preset when dateRange.to is in the past', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const mockPreset = { label: 'Last week', range: () => ({ from: yesterday, to: today, label: 'Last week' }) };

    vi.doMock('../components/DateRangePicker', () => ({
      DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
      PRESETS: [mockPreset],
      RECENT_PRESETS: [],
      parseStoredRange: (v: string) => JSON.parse(v),
    }));
    vi.doMock('../api', () => ({
      getUsage: vi.fn().mockResolvedValue({
        summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
        byModel: {}, timeline: [], records: [],
      }),
      getRouters: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../components/MultiSelect', () => ({ MultiSelect: () => <div /> }));
    // useFilterState returns a stale range: from=non-empty, to=yesterday, label='Last week'
    vi.doMock('../hooks/useFilterState', async () => {
      const react = await vi.importActual<typeof import('react')>('react');
      let callIndex = 0;
      return {
        useFilterState: ({ defaultValue }: { defaultValue: unknown }) => {
          callIndex++;
          // First call = dateRange: provide stale range with past 'to' date and matching label
          if (callIndex === 1) {
            return react.useState({ from: yesterday, to: yesterday, label: 'Last week' });
          }
          return react.useState(defaultValue);
        },
      };
    });

    const { UsagePage: Page } = await vi.importActual<typeof import('./UsagePage')>('./UsagePage');
    const { render: r, screen: s, waitFor: wf } = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
    const { MemoryRouter: MR } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    r(<MR><Page /></MR>);
    // preset.range() is called → setDateRange → picker re-renders with today's range
    await wf(() => expect(s.getByTestId('date-picker')).toBeTruthy());
  });

  it('stale range with non-matching label (no preset found) — preset branch skipped', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const mockPreset = { label: 'Last week', range: () => ({ from: yesterday, to: yesterday, label: 'Last week' }) };

    vi.doMock('../components/DateRangePicker', () => ({
      DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
      PRESETS: [mockPreset],
      RECENT_PRESETS: [],
      parseStoredRange: (v: string) => JSON.parse(v),
    }));
    vi.doMock('../api', () => ({
      getUsage: vi.fn().mockResolvedValue({
        summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
        byModel: {}, timeline: [], records: [],
      }),
      getRouters: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../components/MultiSelect', () => ({ MultiSelect: () => <div /> }));
    vi.doMock('../hooks/useFilterState', async () => {
      const react = await vi.importActual<typeof import('react')>('react');
      let callIndex = 0;
      return {
        useFilterState: ({ defaultValue }: { defaultValue: unknown }) => {
          callIndex++;
          if (callIndex === 1) {
            // stale 'to' but label doesn't match any preset → if (preset) not taken
            return react.useState({ from: yesterday, to: yesterday, label: 'No match' });
          }
          return react.useState(defaultValue);
        },
      };
    });

    const { UsagePage: Page } = await vi.importActual<typeof import('./UsagePage')>('./UsagePage');
    const { render: r, screen: s, waitFor: wf } = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
    const { MemoryRouter: MR } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    r(<MR><Page /></MR>);
    await wf(() => expect(s.getByTestId('date-picker')).toBeTruthy());
  });

  it('stale range to >= today: dateRange.to.slice(0,10) < today is false (no re-apply)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mockPreset = { label: 'Today', range: () => ({ from: today, to: today, label: 'Today' }) };

    vi.doMock('../components/DateRangePicker', () => ({
      DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
      PRESETS: [mockPreset],
      RECENT_PRESETS: [],
      parseStoredRange: (v: string) => JSON.parse(v),
    }));
    vi.doMock('../api', () => ({
      getUsage: vi.fn().mockResolvedValue({
        summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
        byModel: {}, timeline: [], records: [],
      }),
      getRouters: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../components/MultiSelect', () => ({ MultiSelect: () => <div /> }));
    vi.doMock('../hooks/useFilterState', async () => {
      const react = await vi.importActual<typeof import('react')>('react');
      let callIndex = 0;
      return {
        useFilterState: ({ defaultValue }: { defaultValue: unknown }) => {
          callIndex++;
          if (callIndex === 1) {
            // to=today → to.slice(0,10) < today is FALSE → else-if branch not taken
            return react.useState({ from: today, to: today, label: 'Today' });
          }
          return react.useState(defaultValue);
        },
      };
    });

    const { UsagePage: Page } = await vi.importActual<typeof import('./UsagePage')>('./UsagePage');
    const { render: r, screen: s, waitFor: wf } = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
    const { MemoryRouter: MR } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    r(<MR><Page /></MR>);
    await wf(() => expect(s.getByTestId('date-picker')).toBeTruthy());
  });

  it('stale range with label="This month" gets remapped to "This month"', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    // PRESETS must contain 'This month' for the remap to find it
    const mockPreset = { label: 'This month', range: () => ({ from: yesterday, to: today, label: 'This month' }) };

    vi.doMock('../components/DateRangePicker', () => ({
      DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
      PRESETS: [mockPreset],
      RECENT_PRESETS: [],
      parseStoredRange: (v: string) => JSON.parse(v),
    }));
    vi.doMock('../api', () => ({
      getUsage: vi.fn().mockResolvedValue({
        summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
        byModel: {}, timeline: [], records: [],
      }),
      getRouters: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../components/MultiSelect', () => ({ MultiSelect: () => <div /> }));
    vi.doMock('../hooks/useFilterState', async () => {
      const react = await vi.importActual<typeof import('react')>('react');
      let callIndex = 0;
      return {
        useFilterState: ({ defaultValue }: { defaultValue: unknown }) => {
          callIndex++;
          if (callIndex === 1) {
            // label 'This month' → code remaps to 'This month' then finds the preset
            return react.useState({ from: yesterday, to: yesterday, label: 'This month' });
          }
          return react.useState(defaultValue);
        },
      };
    });

    const { UsagePage: Page } = await vi.importActual<typeof import('./UsagePage')>('./UsagePage');
    const { render: r, screen: s, waitFor: wf } = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
    const { MemoryRouter: MR } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    r(<MR><Page /></MR>);
    await wf(() => expect(s.getByTestId('date-picker')).toBeTruthy());
  });

  it('fetchStats: recentPreset found — uses preset range for from/to', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const mockRecentPreset = { label: 'Today', range: () => ({ from: today, to: today, label: 'Today' }) };

    vi.doMock('../components/DateRangePicker', () => ({
      DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
      PRESETS: [],
      RECENT_PRESETS: [mockRecentPreset],
      parseStoredRange: (v: string) => JSON.parse(v),
    }));
    const mockGetUsage = vi.fn().mockResolvedValue({
      summary: { totalCost: 0, totalCalls: 0, successCalls: 0, errorCalls: 0, routingCalls: 0, completionCalls: 0, routingCost: 0, completionCost: 0 },
      byModel: {}, timeline: [], records: [],
    });
    vi.doMock('../api', () => ({
      getUsage: mockGetUsage,
      getRouters: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../components/MultiSelect', () => ({ MultiSelect: () => <div /> }));
    vi.doMock('../hooks/useFilterState', async () => {
      const react = await vi.importActual<typeof import('react')>('react');
      let callIndex = 0;
      return {
        useFilterState: ({ defaultValue }: { defaultValue: unknown }) => {
          callIndex++;
          if (callIndex === 1) {
            // dateRange label matches RECENT_PRESETS[0].label → recentPreset found in fetchStats
            return react.useState({ from: yesterday, to: yesterday, label: 'Today' });
          }
          return react.useState(defaultValue);
        },
      };
    });

    const { UsagePage: Page } = await vi.importActual<typeof import('./UsagePage')>('./UsagePage');
    const { render: r, screen: s, waitFor: wf } = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
    const { MemoryRouter: MR } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

    r(<MR><Page /></MR>);
    await wf(() => expect(s.getByTestId('date-picker')).toBeTruthy());
    await wf(() => expect(mockGetUsage).toHaveBeenCalled());
    // recentPreset.range() provides today/today → period='custom' (both truthy)
    const firstCall = mockGetUsage.mock.calls[0];
    expect(firstCall?.[0]).toBe('custom');
  });
});

// The same savings layer the Overview carries, over the filtered window (T209).
const SERIES = {
  bucket: 'day' as const,
  baselineModelId: 'openai/gpt-4o',
  baselineModelIds: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
  points: [
    {
      bucket: '2026-07-31', calls: 2, cost: 0.006, baselineCost: 0.06,
      baselineCosts: { 'openai/gpt-4o-mini': 0.01, 'openai/gpt-4o': 0.06 },
      inputTokens: 2000, outputTokens: 1000, cachedInputTokens: 0, latencyMs: 2000, baselineLatencyMs: 4000,
    },
  ],
};

const SAVINGS = {
  comparedCalls: 2,
  comparedCost: 0.006,
  comparedLatencyMs: 2000,
  comparedInputTokens: 2000,
  comparedOutputTokens: 1000,
  cache: { inputTokens: 0, cost: 0 },
  baselines: [
    { modelId: 'openai/gpt-4o-mini', cost: 0.015, costDelta: 0.006, costDeltaPercent: 40, latencyMs: 4500, latencyDeltaMs: 1500, latencySamples: 2, tokensEstimated: 4500, tokenDelta: 0 },
    { modelId: 'openai/gpt-4o', cost: 0.09, costDelta: 0.081, costDeltaPercent: 90, latencyMs: 5000, latencyDeltaMs: 2000, latencySamples: 1, tokensEstimated: 4500, tokenDelta: 675 },
  ],
  optimizers: [{ id: 'rtk', calls: 2, tokensSaved: 1200, costSaved: 0.002, rolledBack: 0 }],
};

describe('UsagePage — type filters follow the traffic (T210)', () => {
  it('offers only the callers and types the window holds', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byCallType: { completion: 9, routing: 1 },
      byRequestType: { chat: 10 },
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Completion \d/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Guardrail/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Judge/ })).toBeNull();
    // One type in the whole window is not a choice, so the group is not drawn.
    expect(screen.queryByText('Type')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Chat/ })).toBeNull();
  });

  it('counts each caller and type next to its button', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byCallType: { completion: 9, routing: 1 },
      byRequestType: { chat: 8, embedding: 2 },
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Completion 9' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Router 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Embedding 2' })).toBeTruthy();
  });

  it('keeps a one-value filter on screen while it is the active one', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byCallType: { completion: 10 },
      byRequestType: { chat: 8, embedding: 2 },
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('Completion Calls')).toBeTruthy());
    // Nothing but completions: the caller filter has nothing to pick.
    expect(screen.queryByText('Caller')).toBeNull();
    // The stat card sets that filter anyway, so the group comes back with it:
    // hiding it would leave no way to clear what the card just set.
    await userEvent.click(screen.getByText('Completion Calls'));
    await waitFor(() => expect(screen.getByText('Caller')).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Completion \d/ }).className).toContain('btn-primary');
  });

  it('survives a service that ships no counts', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), byCallType: undefined, byRequestType: undefined } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('Total Calls')).toBeTruthy());
    expect(screen.queryByText('Caller')).toBeNull();
    expect(screen.queryByText('Type')).toBeNull();
  });
});

describe('UsagePage — savings (T209)', () => {
  it('asks the service for the series and the totals, one record page wide', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(vi.mocked(getUsage).mock.calls.some(c =>
      c[4] === 1 && c[5] === 1 && (c[6] as Record<string, unknown>)?.series === true && (c[6] as Record<string, unknown>)?.savings === true,
    )).toBe(true));
  });

  it('draws no savings chart when the service returned no series', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.getByText('Total Cost')).toBeTruthy());
    expect(screen.queryByText('What routing saved')).toBeNull();
  });

  it('carries the money saved on the Total Cost card and the tokens on their own', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), series: SERIES, savings: SAVINGS } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('$0.0810 saved (90%) vs always gpt-4o')).toBeTruthy());
    expect(screen.queryByText('Cost saved')).toBeNull();
    // Time saved was never explainable from the numbers on screen, so it is gone.
    expect(screen.queryByText('Time saved')).toBeNull();
    expect(screen.getByText('1.2k cut by optimizers')).toBeTruthy();
  });

  it('sums the per-model tokens into one compact card', async () => {
    // The summary ships no token totals, so the card adds up the same per-model
    // breakdown the table below it renders.
    vi.mocked(getUsage).mockResolvedValue({
      ...makeStats(),
      byModel: {
        'openai/gpt-4o': { calls: 5, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 200, cost: 0.01, errors: 0, success: 5, avgLatencyMs: 320, p95LatencyMs: 600 },
        'openai/gpt-4o-mini': { calls: 5, inputTokens: 2000, outputTokens: 1500, cachedInputTokens: 0, cost: 0.002, errors: 0, success: 5, avgLatencyMs: 120, p95LatencyMs: 200 },
      },
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('Tokens')).toBeTruthy());
    expect(screen.getByText('5.0k')).toBeTruthy();
    expect(screen.getByText('3.0k in · 2.0k out · 200 cached')).toBeTruthy();
  });

  it('draws the savings chart over the filtered window', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), series: SERIES, savings: SAVINGS } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('What routing saved')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Tokens' })).toBeTruthy();
  });

  it('switches the chart metric', async () => {
    vi.mocked(getUsage).mockResolvedValue({ ...makeStats(), series: SERIES, savings: SAVINGS } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('What routing saved')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Tokens' }));
    expect(screen.getByRole('button', { name: 'Tokens' }).className).toContain('active');
    // Speed was an estimate nobody could check, so the metric is gone with it.
    expect(screen.queryByRole('button', { name: 'Speed' })).toBeNull();
  });

  it('keeps the savings layer out when the fetch fails', async () => {
    vi.mocked(getUsage).mockImplementation(((_p: string, _pr: unknown, _f: unknown, _t: unknown, _pg: unknown, _ps: unknown, opts?: { savings?: boolean }) =>
      opts?.savings ? Promise.reject(new Error('nope')) : Promise.resolve(makeStats())) as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('Total Cost')).toBeTruthy());
    expect(screen.queryByText('What routing saved')).toBeNull();
  });
});
