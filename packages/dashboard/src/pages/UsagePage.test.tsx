import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsagePage } from './UsagePage';

// ponytail: mock api at module level; only stub what UsagePage calls
vi.mock('../api', () => ({
  getUsage: vi.fn(),
  getProjects: vi.fn(),
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
import { getUsage, getProjects } from '../api';

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
      // Multiple "All" buttons exist (Type + Status); test the unique ones
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
