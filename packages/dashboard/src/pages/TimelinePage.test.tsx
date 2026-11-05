import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TimelinePage } from './TimelinePage';

vi.mock('../api', () => ({ getTimeline: vi.fn(), getRouters: vi.fn() }));
let mockCan = true;
vi.mock('../AuthContext', () => ({ useAuth: () => ({ can: () => mockCan }) }));
vi.mock('../components/DateRangePicker', () => ({
  DateRangePicker: ({ value }: { value: { label?: string } }) => <div data-testid="date-picker">{value.label}</div>,
  PRESETS: [{ label: 'This month', range: () => ({ from: '2024-06-01', to: '2024-06-30', label: 'This month' }) }],
  RECENT_PRESETS: [],
  parseStoredRange: (v: string) => JSON.parse(v),
}));
vi.mock('../hooks/useFilterState', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return { useFilterState: ({ defaultValue }: { defaultValue: unknown }) => react.useState(defaultValue) };
});
import { getTimeline, getRouters } from '../api';

const ev = (o: Record<string, unknown>) => ({
  id: 'e', timestamp: '2024-06-02T10:00:00Z', kind: 'attempt', outcome: 'success', durationMs: 120, cost: 0.002, ...o,
});
function makeData(groups: unknown[] = defaultGroups()) {
  return {
    groups,
    totals: { groups: groups.length, events: 4, cost: null, eventsByKind: {} },
    pagination: { page: 1, pageSize: 25, totalRecords: groups.length, totalPages: 1 },
  };
}
function defaultGroups() {
  return [
    {
      id: 'tr1', startedAt: '2024-06-02T10:00:00Z', endedAt: '2024-06-02T10:00:02Z', durationMs: 2000, routerId: 'r1',
      outcome: 'success', attempts: 2, fallback: true, correlated: true, cost: null,
      events: [
        ev({ id: 'e1', attempt: 1, outcome: 'error', errorMessage: 'upstream 500', cost: null, modelId: 'openai/gpt-4o', recordId: 'rec1' }),
        ev({ id: 'e2', attempt: 2, final: true, modelId: 'anthropic/claude', ttftMs: 80, recordId: 'rec2' }),
      ],
    },
    {
      id: 'u1', startedAt: '2024-06-01T10:00:00Z', endedAt: '2024-06-01T10:00:00Z', durationMs: 5, outcome: 'blocked',
      attempts: 0, fallback: false, correlated: false, cost: null,
      events: [ev({ id: 'm1', kind: 'mcp', name: 'list_models', outcome: 'blocked', blockedBy: 'perm', cost: null })],
    },
  ];
}
const renderPage = () => render(<MemoryRouter><TimelinePage /></MemoryRouter>);

beforeEach(() => {
  mockCan = true;
  vi.mocked(getTimeline).mockReset();
  vi.mocked(getRouters).mockResolvedValue([{ id: 'r1', name: 'Main router', tokens: [] }] as never);
});

describe('TimelinePage', () => {
  it('without report:read shows the message and fetches nothing', async () => {
    mockCan = false;
    renderPage();
    expect(screen.getByText(/permission to view the timeline/)).toBeTruthy();
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it('renders groups with router name, fallback and not-correlated markers, null cost as an em dash', async () => {
    vi.mocked(getTimeline).mockResolvedValue(makeData() as never);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('timeline-group')).toHaveLength(2));
    expect(screen.getByText('Main router')).toBeTruthy();
    expect(screen.getByText('2 attempts')).toBeTruthy();
    expect(screen.getByText('Fallback')).toBeTruthy();
    expect(screen.getByText('Not correlated')).toBeTruthy();
    for (const c of screen.getAllByTestId('group-cost')) expect(c.textContent).toBe('—');
  });

  it('expands a group into events with error, blockedBy, TTFT and usage links; unknown event cost is an em dash', async () => {
    vi.mocked(getTimeline).mockResolvedValue(makeData() as never);
    renderPage();
    await waitFor(() => screen.getAllByTestId('timeline-group'));
    expect(screen.queryAllByTestId('timeline-event')).toHaveLength(0);
    const groups = screen.getAllByTestId('timeline-group');
    await userEvent.click(within(groups[0]!).getByRole('button', { name: 'Show events' }));
    const events = screen.getAllByTestId('timeline-event');
    expect(events).toHaveLength(2);
    expect(within(events[0]!).getByText('upstream 500')).toBeTruthy();
    expect(within(events[0]!).getByTestId('event-cost').textContent).toBe('—');
    expect(within(events[1]!).getByTestId('event-cost').textContent).toBe('$0.002');
    expect(within(events[1]!).getByText(/TTFT 80 ms/)).toBeTruthy();
    expect(within(events[1]!).getByRole('link', { name: 'Open usage record' }).getAttribute('href')).toBe('/dashboard/usage/rec2');
    await userEvent.click(within(groups[1]!).getByRole('button', { name: 'Show events' }));
    expect(screen.getByText(/Blocked by perm/)).toBeTruthy();
  });

  it('typing a session id refetches with it', async () => {
    vi.mocked(getTimeline).mockResolvedValue(makeData() as never);
    renderPage();
    await waitFor(() => screen.getAllByTestId('timeline-group'));
    await userEvent.type(screen.getByLabelText('Session ID'), 's1');
    await waitFor(() => expect(vi.mocked(getTimeline).mock.lastCall![0]).toMatchObject({ sessionId: 's1', page: 1 }));
  });

  it('shows the empty state', async () => {
    vi.mocked(getTimeline).mockResolvedValue(makeData([]) as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('No requests match these filters.')).toBeTruthy());
  });

  it('shows the real error message', async () => {
    vi.mocked(getTimeline).mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });
});
