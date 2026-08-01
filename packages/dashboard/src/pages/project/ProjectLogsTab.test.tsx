import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectLogsTab } from './ProjectLogsTab';

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
  // Include one recent preset so the recentPreset.range() branch (lines 64-66) is reachable
  RECENT_PRESETS: [
    { label: 'Last 1h', range: () => ({ from: '2024-06-01T09:00:00Z', to: '2024-06-01T10:00:00Z', label: 'Last 1h' }) },
  ],
  parseStoredRange: (v: string) => JSON.parse(v),
}));

// ponytail: mock MultiSelect as a plain <select multiple>
vi.mock('../../components/MultiSelect', () => ({
  MultiSelect: ({ options, value, onChange, placeholder }: {
    options: { value: string; label: string }[];
    value: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
  }) => (
    <select
      multiple
      data-testid={`multiselect-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { getUsage } from '../../api';
const mockGetUsage = vi.mocked(getUsage as (...a: unknown[]) => Promise<unknown>);

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      totalCost: 1.23,
      totalCalls: 10,
      completionCalls: 8,
      completionCost: 1.1,
      routingCalls: 2,
      routingCost: 0.13,
      errorCalls: 1,
    },
    records: [
      {
        id: 'rec-1',
        timestamp: '2024-06-01T10:00:00Z',
        modelId: 'openai/gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.005,
        latencyMs: 300,
        ttftMs: 120,
        tokensPerSec: 45,
        outcome: 'success' as const,
        callType: 'completion' as const,
      },
      {
        id: 'rec-2',
        timestamp: '2024-06-01T11:00:00Z',
        modelId: 'openai/gpt-4o',
        inputTokens: 50,
        outputTokens: 20,
        cost: 0.002,
        latencyMs: 200,
        ttftMs: null,
        tokensPerSec: null,
        outcome: 'error' as const,
        callType: 'routing' as const,
      },
      {
        id: 'rec-3',
        timestamp: '2024-06-01T12:00:00Z',
        modelId: 'openai/gpt-3.5',
        inputTokens: 30,
        outputTokens: 10,
        cost: 0.001,
        latencyMs: 100,
        ttftMs: 50,
        tokensPerSec: 30,
        outcome: 'blocked' as const,
        callType: 'completion' as const,
      },
      {
        // No callType → exercises `r.callType ?? 'completion'` fallback (lines 100, 292)
        id: 'rec-4',
        timestamp: '2024-06-01T13:00:00Z',
        modelId: 'openai/gpt-3.5',
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.0005,
        latencyMs: 80,
        ttftMs: null,
        tokensPerSec: null,
        outcome: 'success' as const,
        callType: undefined,
      },
    ],
    pagination: { page: 1, totalPages: 1, totalRecords: 4 },
    byModel: {},
    ...overrides,
  };
}

const mockProject = { id: 'proj-1', name: 'Test', models: [] };

function renderTab() {
  function LayoutWrapper() {
    return <Outlet context={{ project: mockProject, setProject: vi.fn() }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/projects/proj-1/logs']}>
      <Routes>
        <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
          <Route path="logs" element={<ProjectLogsTab />} />
        </Route>
        <Route path="/dashboard/usage/:id" element={<div data-testid="usage-detail">usage</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetUsage.mockResolvedValue(makeStats());
  localStorage.clear();
});

afterEach(() => vi.clearAllMocks());

// ── Loading & empty states ────────────────────────────────────────────────────

describe('ProjectLogsTab — loading state', () => {
  it('shows spinner while loading', () => {
    mockGetUsage.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

describe('ProjectLogsTab — stats when loaded', () => {
  it('shows Total Cost stat card', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Total Cost')).toBeTruthy());
    expect(screen.getByText('$1.2300')).toBeTruthy();
  });

  it('shows Total Calls stat card', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Total Calls')).toBeTruthy());
    // '10' also appears in table (outputTokens for rec-3), so find within the stat card
    const totalCallsCard = screen.getByText('Total Calls').closest('.stat-card')!;
    expect(totalCallsCard.querySelector('.stat-value')?.textContent).toBe('10');
  });

  it('shows Completion Calls stat card', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Completion Calls')).toBeTruthy());
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('shows Router Calls stat card', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Router Calls')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows Errors stat card', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Errors')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('stats fallback: completionCalls ?? totalCalls when completionCalls absent', async () => {
    // mockResolvedValue (not Once) so re-fetches triggered by dateRange init also return this data
    mockGetUsage.mockResolvedValue(makeStats({
      summary: {
        totalCost: 1.0, totalCalls: 5,
        completionCalls: undefined, completionCost: undefined,
        routingCalls: undefined, routingCost: undefined,
        errorCalls: 0,
      },
    }));
    renderTab();
    await waitFor(() => expect(screen.getByText('Completion Calls')).toBeTruthy());
    // completionCalls ?? totalCalls = 5; find within stat card to avoid ambiguity with Total Calls=5
    const completionCard = screen.getByText('Completion Calls').closest('.stat-card')!;
    expect(completionCard.querySelector('.stat-value')?.textContent).toBe('5');
  });

  it('stats fallback: routingCalls ?? 0 when routingCalls absent', async () => {
    // mockResolvedValue (not Once) so re-fetches triggered by dateRange init also return this data
    mockGetUsage.mockResolvedValue(makeStats({
      summary: {
        totalCost: 1.0, totalCalls: 5,
        completionCalls: 5, completionCost: 1.0,
        routingCalls: undefined, routingCost: undefined,
        errorCalls: 0,
      },
    }));
    renderTab();
    await waitFor(() => expect(screen.getByText('Router Calls')).toBeTruthy());
    // routingCalls ?? 0 = 0; find within stat card to avoid ambiguity with Errors=0
    const routerCard = screen.getByText('Router Calls').closest('.stat-card')!;
    expect(routerCard.querySelector('.stat-value')?.textContent).toBe('0');
  });
});

describe('ProjectLogsTab — records table', () => {
  it('renders records table with Request Logs heading', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Request Logs')).toBeTruthy());
  });

  it('renders all column headers', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Request Logs')).toBeTruthy());
    const thead = document.querySelector('thead')!;
    expect(thead.querySelector('th[title], th')?.closest('thead')).toBeTruthy();
    // 'Model' appears in both FilterLabel and <th>; check the <th> specifically
    const ths = Array.from(thead.querySelectorAll('th')).map(th => th.textContent?.trim());
    expect(ths).toContain('Time');
    expect(ths).toContain('Model');
    expect(ths).toContain('Type');
    expect(ths).toContain('In');
    expect(ths).toContain('Out');
    expect(ths).toContain('Cost');
    expect(ths).toContain('Latency');
    expect(ths).toContain('TTFT');
    expect(ths).toContain('Status');
  });

  it('renders record rows', async () => {
    renderTab();
    await waitFor(() => expect(screen.getAllByText('openai/gpt-4o').length).toBeGreaterThan(0));
  });

  it('shows ttftMs value when present', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('120ms')).toBeTruthy());
  });

  it('shows — for null ttftMs', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Request Logs')).toBeTruthy());
    // rec-2 has ttftMs: null → '—'
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows tokensPerSec value when present', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('45')).toBeTruthy());
  });

  it('shows outcome badges', async () => {
    renderTab();
    await waitFor(() => expect(screen.getAllByText('success').length).toBeGreaterThan(0));
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('blocked')).toBeTruthy();
  });

  it('shows completion and router type badges', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getAllByText('completion').length).toBeGreaterThan(0);
      expect(screen.getByText('router')).toBeTruthy();
    });
  });

  it('clicking a row navigates to usage detail', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    const rows = document.querySelectorAll('tbody tr');
    await userEvent.click(rows[0]!);
    await waitFor(() => expect(screen.getByTestId('usage-detail')).toBeTruthy());
  });
});

describe('ProjectLogsTab — empty records state', () => {
  it('shows empty state when no records', async () => {
    // mockResolvedValue (not Once) so re-fetches from dateRange init also return empty data
    mockGetUsage.mockResolvedValue(makeStats({ records: [], pagination: { page: 1, totalPages: 1, totalRecords: 0 } }));
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('No requests for this project in the selected period.')).toBeTruthy()
    );
  });
});

describe('ProjectLogsTab — null stats (getUsage returns null-like)', () => {
  it('renders nothing (no table) when stats is null after fetch error swallowed', async () => {
    // mockRejectedValue (not Once) so re-fetches from dateRange init also fail; stats stays null
    mockGetUsage.mockRejectedValue(new Error('fail'));
    renderTab();
    await waitFor(() => expect(document.querySelector('.spinner')).toBeNull());
    expect(screen.queryByText('Request Logs')).toBeNull();
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe('ProjectLogsTab — call type filter', () => {
  it('clicking Completion filter shows only completion records', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Completion' }));
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(3); // rec-1, rec-3 (explicit completion) + rec-4 (callType undefined → ?? 'completion')
    });
  });

  it('clicking Router filter shows only routing records', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Router' }));
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1); // rec-2 is routing
    });
  });

  it('clicking active filter again resets to All', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Completion' }));
    // Now stat card click — Completion stat card toggles filter too
    const completionCard = screen.getByText('Completion Calls').closest('.stat-card')!;
    await userEvent.click(completionCard);
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(4);
    });
  });
});

describe('ProjectLogsTab — outcome filter', () => {
  it('clicking Success filter shows only successful records', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Success' }));
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2); // rec-1 and rec-4 both have outcome='success'
    });
  });

  it('clicking Error filter shows only error records', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Error' }));
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1);
    });
  });

  it('clicking Blocked filter shows only blocked records', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Blocked' }));
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1);
    });
  });
});

describe('ProjectLogsTab — Reset filters button', () => {
  it('Reset filters button appears when a filter is active', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Completion' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset filters' })).toBeTruthy());
  });

  it('Reset filters clears all active filters', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Completion' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull());
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(4);
  });
});

describe('ProjectLogsTab — "No records match" empty state', () => {
  it('shows "No records match the active filters" when filter leaves 0 matches', async () => {
    // mockResolvedValue (not Once) so re-fetches from dateRange init also return this data
    mockGetUsage.mockResolvedValue(makeStats({
      records: [
        { id: 'r1', timestamp: '2024-06-01T10:00:00Z', modelId: 'openai/gpt-4o', inputTokens: 10, outputTokens: 5, cost: 0.001, latencyMs: 100, ttftMs: null, tokensPerSec: null, outcome: 'error', callType: 'completion' },
      ],
      pagination: { page: 1, totalPages: 1, totalRecords: 1 },
    }));
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    await userEvent.click(screen.getByRole('button', { name: 'Success' }));
    await waitFor(() =>
      expect(screen.getByText('No records match the active filters.')).toBeTruthy()
    );
  });
});

// ── Poll interval controls ────────────────────────────────────────────────────

describe('ProjectLogsTab — poll interval controls', () => {
  it('shows auto-refresh status text', async () => {
    renderTab();
    // Either "Auto-refresh disabilitato" or "Auto-refresh ogni ..." is visible
    await waitFor(() => expect(document.querySelector('.card')).toBeTruthy());
    expect(document.body.textContent).toMatch(/Auto-refresh/);
  });

  it('clicking Off sets pollInterval to 0', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: 'Off' }));
    await userEvent.click(screen.getByRole('button', { name: 'Off' }));
    // "Auto-refresh disabilitato" should appear
    await waitFor(() =>
      expect(screen.getByText(/Auto-refresh disabilitato/)).toBeTruthy()
    );
  });

  it('clicking 5s sets pollInterval to 5s', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: '5s' }));
    await userEvent.click(screen.getByRole('button', { name: '5s' }));
    await waitFor(() =>
      expect(screen.getByText(/Auto-refresh ogni 5s/)).toBeTruthy()
    );
  });

  it('clicking Now triggers immediate refresh', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Now/ }));
    const callsBefore = mockGetUsage.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /Now/ }));
    await waitFor(() => expect(mockGetUsage.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

// ── Stat card toggle — completion/router filter via card click ────────────────

describe('ProjectLogsTab — stat card toggle', () => {
  it('clicking Router Calls card sets callTypeFilter to routing', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Router Calls'));
    const routerCard = screen.getByText('Router Calls').closest('.stat-card')!;
    await userEvent.click(routerCard);
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1);
    });
  });

  it('clicking Completion card when filter is routing sets filter to completion (else branch, line 221)', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Router Calls'));
    // First set to routing via Router Calls card
    const routerCard = screen.getByText('Router Calls').closest('.stat-card')!;
    await userEvent.click(routerCard);
    await waitFor(() => document.querySelectorAll('tbody tr').length === 1);
    // Now click Completion card — f='routing' !== 'completion' → sets 'completion' (else branch)
    const completionCard = screen.getByText('Completion Calls').closest('.stat-card')!;
    await userEvent.click(completionCard);
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(3); // rec-1, rec-3, rec-4 (callType completion or undefined)
    });
  });

  it('clicking Router card when filter is completion sets filter to routing (else branch, line 235)', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Completion Calls'));
    // Set to completion via button
    await userEvent.click(screen.getByRole('button', { name: 'Completion' }));
    await waitFor(() => document.querySelectorAll('tbody tr').length === 3);
    // Now click Router Calls card — f='completion' !== 'routing' → sets 'routing' (else branch)
    const routerCard = screen.getByText('Router Calls').closest('.stat-card')!;
    await userEvent.click(routerCard);
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1); // only rec-2
    });
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('ProjectLogsTab — pagination', () => {
  it('shows pagination controls when totalPages > 1', async () => {
    // mockResolvedValue (not Once) so re-fetches from dateRange init also return paged data
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 3, totalRecords: 300 } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/Pagina 1 di 3/)).toBeTruthy());
  });

  it('Previous button disabled on page 1', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 3, totalRecords: 300 } }));
    renderTab();
    await waitFor(() => screen.getByText(/Pagina 1 di 3/));
    const prevBtn = screen.getByRole('button', { name: /Precedente/ }) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it('Next button navigates to page 2', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 3, totalRecords: 300 } }));
    renderTab();
    await waitFor(() => screen.getByText(/Pagina 1 di 3/));
    // Switch mock to return page 2 data before clicking Next
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 2, totalPages: 3, totalRecords: 300 } }));
    await userEvent.click(screen.getByRole('button', { name: /Successiva/ }));
    await waitFor(() => expect(screen.getByText(/Pagina 2 di 3/)).toBeTruthy());
  });

  it('Next button disabled on last page', async () => {
    // Start on page 1 of 2, navigate to last page, then check Next is disabled
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 2, totalRecords: 200 } }));
    renderTab();
    await waitFor(() => screen.getByText(/Pagina 1 di 2/));
    // Switch mock so clicking Next returns page 2 data
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 2, totalPages: 2, totalRecords: 200 } }));
    await userEvent.click(screen.getByRole('button', { name: /Successiva/ }));
    await waitFor(() => screen.getByText(/Pagina 2 di 2/));
    // Now React page state = 2 = totalPages → Next is disabled
    const nextBtn = screen.getByRole('button', { name: /Successiva/ }) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it('pagination hidden when totalPages <= 1', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    expect(screen.queryByText(/Pagina/)).toBeNull();
  });

  it('shows total record count in pagination', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 3, totalRecords: 300 } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/300 record totali/)).toBeTruthy());
  });
});

// ── Pagination count in records heading ───────────────────────────────────────

describe('ProjectLogsTab — records heading count', () => {
  it('shows filtered/total count when pagination present', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    // 4 / 4 shown (pagination.totalRecords=4, filteredRecords.length=4)
    expect(screen.getByText(/4 \/ 4/)).toBeTruthy();
  });

  it('shows only filtered count when no pagination object', async () => {
    mockGetUsage.mockResolvedValue({ ...makeStats(), pagination: undefined });
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    // no '/ X' — just the length
    expect(screen.queryByText(/\/ 3/)).toBeNull();
  });
});

// ── Recent preset branch (lines 64-66) ────────────────────────────────────────

describe('ProjectLogsTab — recent preset recalculates range on fetch', () => {
  it('triggers fetchStats with recalculated range when dateRange matches a RECENT_PRESET label', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    // Change the date range picker label to match the mocked RECENT_PRESETS entry
    const picker = screen.getByTestId('date-range-picker') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: 'Last 1h' } });
    // fetchStats runs again and should still call getUsage (preset.range() path exercised)
    await waitFor(() => expect(mockGetUsage.mock.calls.length).toBeGreaterThan(1));
  });
});

// ── Previous page functional updater (line 341) ───────────────────────────────

describe('ProjectLogsTab — Previous page button', () => {
  it('clicking Previous from page 2 goes back to page 1', async () => {
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 3, totalRecords: 300 } }));
    renderTab();
    await waitFor(() => screen.getByText(/Pagina 1 di 3/));
    // Navigate to page 2
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 2, totalPages: 3, totalRecords: 300 } }));
    await userEvent.click(screen.getByRole('button', { name: /Successiva/ }));
    await waitFor(() => screen.getByText(/Pagina 2 di 3/));
    // Go back — exercises setPage(p => Math.max(1, p - 1))
    mockGetUsage.mockResolvedValue(makeStats({ pagination: { page: 1, totalPages: 3, totalRecords: 300 } }));
    await userEvent.click(screen.getByRole('button', { name: /Precedente/ }));
    await waitFor(() => expect(screen.getByText(/Pagina 1 di 3/)).toBeTruthy());
  });
});

// ── Model filter (line 99 return false branch) ──────────��─────────────────────

describe('ProjectLogsTab — model filter', () => {
  it('selecting a model filters to only matching records', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    // Select only 'openai/gpt-3.5' — covers modelIds.length>0 && !includes → return false
    const multiSelect = screen.getByTestId('multiselect-All Models') as HTMLSelectElement;
    await userEvent.selectOptions(multiSelect, ['openai/gpt-3.5']);
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2); // rec-3 and rec-4 are gpt-3.5
    });
  });
});

// ── dateRange already set (lines 46-54 false branch) ─────────────────────────

describe('ProjectLogsTab — skips date init when dates already set', () => {
  it('does not overwrite dateRange.from/to when already present in localStorage', async () => {
    // Pre-populate localStorage so useFilterState initialises with non-empty dates
    localStorage.setItem('project-proj-1-filters-dateRange', JSON.stringify({ from: '2024-01-01', to: '2024-01-31', label: 'Custom' }));
    renderTab();
    await waitFor(() => screen.getByText('Request Logs'));
    // Date-range input keeps the pre-set label (not overwritten to "This month")
    const picker = screen.getByTestId('date-range-picker') as HTMLInputElement;
    expect(picker.value).toBe('Custom');
  });
});

// ── Router card 'routing'→'all' toggle (line 235 true branch) ────────────────

describe('ProjectLogsTab — Router Calls card toggle to all', () => {
  it('clicking Router Calls card when already routing resets to all', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Router Calls'));
    const routerCard = screen.getByText('Router Calls').closest('.stat-card')!;
    // First click sets to routing
    await userEvent.click(routerCard);
    await waitFor(() => document.querySelectorAll('tbody tr').length === 1);
    // Second click: f='routing' → returns 'all' (true branch of f === 'routing' ? 'all' : 'routing')
    await userEvent.click(routerCard);
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBe(4);
    });
  });
});
