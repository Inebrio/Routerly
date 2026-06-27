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

  it('renders provider derived from modelId prefix', async () => {
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

describe('UsagePage — Live mode', () => {
  it('renders the Live button', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => expect(screen.getByText(/● Live/)).toBeTruthy());
  });

  it('toggling Live activates live mode indicator', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const liveBtn = await screen.findByText(/● Live/);
    await userEvent.click(liveBtn);
    await waitFor(() => expect(screen.getByText('LIVE')).toBeTruthy());
  });

  it('toggling Live twice returns to normal mode', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const liveBtn = await screen.findByText(/● Live/);
    await userEvent.click(liveBtn);  // enable
    await waitFor(() => screen.getByText('LIVE'));
    await userEvent.click(liveBtn);  // disable
    await waitFor(() => expect(screen.queryByText('LIVE')).toBeNull());
  });

  it('clicking a poll-interval button while live mode is off sets interval', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    await waitFor(() => screen.getByText(/● Live/));
    const oneMinBtn = screen.getByRole('button', { name: '1m' });
    await userEvent.click(oneMinBtn);
    expect(oneMinBtn.className).toContain('btn-primary');
  });

  it('poll-interval buttons are disabled when live mode is active', async () => {
    vi.mocked(getUsage).mockResolvedValue(makeStats());
    renderPage();
    const liveBtn = await screen.findByText(/● Live/);
    await userEvent.click(liveBtn);
    await waitFor(() => screen.getByText('LIVE'));
    const oneMinBtn = screen.getByRole('button', { name: '1m' });
    expect(oneMinBtn).toBeDisabled();
  });
});
