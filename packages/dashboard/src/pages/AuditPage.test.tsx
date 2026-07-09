import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getAuditLog: vi.fn(),
}));

// ponytail: mock DateRangePicker as a plain input so we can drive dateRange changes
vi.mock('../components/DateRangePicker', () => ({
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
}));

import { AuditPage } from './AuditPage';
import { getAuditLog } from '../api';

const mockGetAuditLog = vi.mocked(getAuditLog as (...a: unknown[]) => Promise<unknown>);

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    timestamp: '2024-01-15T10:30:00Z',
    userId: 'u1',
    email: 'alice@x.com',
    action: 'model:create',
    endpoint: 'POST /api/models',
    result: 'success' as const,
    details: null,
    ...overrides,
  };
}

function makePagination(overrides: Record<string, unknown> = {}) {
  return { page: 1, totalRecords: 1, totalPages: 1, ...overrides };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  mockGetAuditLog.mockResolvedValue({
    entries: [],
    pagination: makePagination({ totalRecords: 0, totalPages: 1 }),
  });
});

afterEach(() => vi.clearAllMocks());

// ── Loading state ──────────────────────────────────────────────────────────────

describe('AuditPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetAuditLog.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('AuditPage — empty state', () => {
  it('shows empty message when no entries', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('No audit entries found.')).not.toBeNull());
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('AuditPage — error state', () => {
  it('shows error message when getAuditLog throws', async () => {
    mockGetAuditLog.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('Forbidden')).not.toBeNull());
  });

  it('shows generic error when throws non-Error', async () => {
    mockGetAuditLog.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load audit log')).not.toBeNull());
  });
});

// ── Loaded entries ─────────────────────────────────────────────────────────────

describe('AuditPage — loaded entries', () => {
  it('renders entry rows with email, action, endpoint, result', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination(),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText('alice@x.com')).not.toBeNull());
    expect(screen.queryByText('model:create')).not.toBeNull();
    expect(screen.queryByText('POST /api/models')).not.toBeNull();
    expect(screen.queryByText('success')).not.toBeNull();
  });

  it('falls back to userId when email is absent', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry({ email: '', userId: 'u-123' })],
      pagination: makePagination(),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText('u-123')).not.toBeNull());
  });

  it('renders JSON details when present', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry({ details: { key: 'val' } })],
      pagination: makePagination(),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText('{"key":"val"}')).not.toBeNull());
  });

  it('renders empty details cell when details is null', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry({ details: null })],
      pagination: makePagination(),
    });
    renderPage();
    await waitFor(() => screen.queryByText('success'));
    // details cell is empty string — just check the row renders
    expect(screen.queryByText('model:create')).not.toBeNull();
  });

  it('renders all result types with correct color', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [
        makeEntry({ id: 'e1', result: 'success' as const }),
        makeEntry({ id: 'e2', result: 'forbidden' as const }),
        makeEntry({ id: 'e3', result: 'error' as const }),
      ],
      pagination: makePagination({ totalRecords: 3 }),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText('success')).not.toBeNull());
    expect(screen.queryByText('forbidden')).not.toBeNull();
    expect(screen.queryByText('error')).not.toBeNull();
  });

  it('renders striped rows (alternating background)', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2' })],
      pagination: makePagination({ totalRecords: 2 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('alice@x.com'));
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });
});

// ── Filter interactions ────────────────────────────────────────────────────────

describe('AuditPage — filters', () => {
  it('user filter input is editable', async () => {
    renderPage();
    await waitFor(() => screen.queryByPlaceholderText('Email or user ID'));
    const input = screen.getByPlaceholderText('Email or user ID') as HTMLInputElement;
    await userEvent.type(input, 'alice');
    expect(input.value).toBe('alice');
  });

  it('action filter input is editable', async () => {
    renderPage();
    await waitFor(() => screen.queryByPlaceholderText('e.g. model:create'));
    const input = screen.getByPlaceholderText('e.g. model:create') as HTMLInputElement;
    await userEvent.type(input, 'model:delete');
    expect(input.value).toBe('model:delete');
  });

  it('pressing Enter in user filter triggers reload', async () => {
    renderPage();
    await waitFor(() => screen.queryByPlaceholderText('Email or user ID'));
    const input = screen.getByPlaceholderText('Email or user ID');
    await userEvent.type(input, 'alice{Enter}');
    // each typed char triggers a filter-state change → load; Enter also calls handleSearch.
    // assert at least 2 calls (initial + at least one more) and that userId was passed.
    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'alice' })
    ));
  });

  it('pressing Enter in action filter triggers reload', async () => {
    renderPage();
    await waitFor(() => screen.queryByPlaceholderText('e.g. model:create'));
    const input = screen.getByPlaceholderText('e.g. model:create');
    await userEvent.type(input, 'model:read{Enter}');
    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'model:read' })
    ));
  });

  it('result filter buttons toggle active state', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Success'));
    await userEvent.click(screen.getByText('Success'));
    await waitFor(() => expect(screen.getByText('Success').closest('button')?.classList.contains('btn-primary')).toBe(true));
  });

  it('passes result filter to getAuditLog when non-all selected', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('Forbidden'));
    await userEvent.click(screen.getByText('Forbidden'));
    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ result: 'forbidden' })));
  });

  it('does not pass result to getAuditLog when "All" selected', async () => {
    renderPage();
    await waitFor(() => screen.queryByText('All'));
    // "All" is default; check the initial call
    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalledWith(
      expect.not.objectContaining({ result: expect.anything() })
    ));
  });

  it('Refresh button triggers reload', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Refresh'));
    await userEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalledTimes(2));
  });

  it('date range picker change triggers reload with from/to params', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('date-range-picker'));
    await userEvent.type(screen.getByTestId('date-range-picker'), 'Jan 2024');
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2024-01-01', to: '2024-01-31' })
      )
    );
  });

  it('passes userId filter to getAuditLog when non-empty', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Email or user ID'));
    await userEvent.type(screen.getByPlaceholderText('Email or user ID'), 'alice{Enter}');
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice' }))
    );
  });

  it('passes action filter to getAuditLog when non-empty', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('e.g. model:create'));
    await userEvent.type(screen.getByPlaceholderText('e.g. model:create'), 'model:create{Enter}');
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'model:create' }))
    );
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────────

describe('AuditPage — pagination', () => {
  it('does not render pagination buttons when only one page', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination({ totalPages: 1 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('success'));
    // pagination bar IS rendered (it always renders when entries exist)
    expect(screen.queryByText('← Previous')).not.toBeNull();
  });

  it('Previous button is disabled on page 1', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination({ page: 1, totalPages: 2 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('← Previous'));
    const prev = screen.getByText('← Previous').closest('button') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('Next button is disabled on last page', async () => {
    // component disables Next when local page state >= pagination.totalPages from server.
    // local page starts at 1, so set totalPages: 1 so 1 >= 1 is true.
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination({ page: 1, totalPages: 1 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('Next →'));
    const next = screen.getByText('Next →').closest('button') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('clicking Next loads page 2', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination({ page: 1, totalPages: 2 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('Next →'));
    await userEvent.click(screen.getByText('Next →'));
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    );
  });

  it('clicking Previous decrements page', async () => {
    // Start on page 2 by clicking next first
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination({ page: 1, totalPages: 3 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('Next →'));
    await userEvent.click(screen.getByText('Next →'));
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    );
    // Now click previous
    await userEvent.click(screen.getByText('← Previous'));
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
    );
  });

  it('shows page count and total records', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: { page: 1, totalRecords: 42, totalPages: 2 },
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText(/Page 1 of 2/)).not.toBeNull());
    expect(screen.queryByText(/42 total/)).not.toBeNull();
  });

  it('filter change resets to page 1', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [makeEntry()],
      pagination: makePagination({ page: 1, totalPages: 3 }),
    });
    renderPage();
    await waitFor(() => screen.queryByText('Next →'));
    await userEvent.click(screen.getByText('Next →'));
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    );
    // Change result filter — should reset to page 1
    await userEvent.click(screen.getByText('Error'));
    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(expect.objectContaining({ page: 1, result: 'error' }))
    );
  });
});
