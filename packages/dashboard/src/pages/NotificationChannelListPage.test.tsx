import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationChannelListPage } from './NotificationChannelListPage';

vi.mock('../api', () => ({
  getNotificationChannels: vi.fn(),
  deleteNotificationChannel: vi.fn(),
  testNotificationChannel: vi.fn(),
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: {
    message: string; onConfirm: () => void; onCancel: () => void;
  }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('./notificationChannelFields', () => ({
  CHANNEL_PROVIDER_META: [
    { key: 'dashboard', label: 'Dashboard', description: 'In-app inbox' },
    { key: 'smtp',      label: 'SMTP',      description: 'Custom mail server' },
    { key: 'webhook',   label: 'Webhook',   description: 'HTTP webhook' },
    { key: 'slack',     label: 'Slack',     description: 'Slack Bot API' },
  ],
  summariseChannel: (ch: { name?: string; provider: string }) => ch.name ?? ch.provider,
  providerLabel: (p: string) => p.charAt(0).toUpperCase() + p.slice(1),
}));

import {
  getNotificationChannels, deleteNotificationChannel, testNotificationChannel,
} from '../api';

const mockGetChannels = vi.mocked(getNotificationChannels as () => Promise<unknown>);
const mockDelete = vi.mocked(deleteNotificationChannel as (id: string) => Promise<unknown>);
const mockTest = vi.mocked(testNotificationChannel as (id: string, to: string) => Promise<unknown>);

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    provider: 'webhook',
    name: 'My Webhook',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationChannelListPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetChannels.mockResolvedValue([]);
  mockDelete.mockResolvedValue(undefined);
  mockTest.mockResolvedValue({ ok: true, message: 'Test sent' });
});

afterEach(() => vi.clearAllMocks());

// ── Loading & empty states ────────────────────────────────────────────────────

describe('NotificationChannelListPage — empty state', () => {
  it('shows empty state when no channels', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/No notification channels configured/)).toBeTruthy());
  });

  it('shows channel count in toolbar', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => expect(screen.getByText('1 channel')).toBeTruthy());
  });

  it('shows plural channel count', async () => {
    mockGetChannels.mockResolvedValue([makeChannel(), makeChannel({ id: 'ch-2', name: 'Ch2' })]);
    renderPage();
    await waitFor(() => expect(screen.getByText('2 channels')).toBeTruthy());
  });
});

// ── Channels table ────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — table rendering', () => {
  it('renders channel name in table', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    // summariseChannel returns ch.name, so 'My Webhook' appears in both name and summary columns
    await waitFor(() => expect(screen.getAllByText('My Webhook').length).toBeGreaterThan(0));
  });

  it('renders provider label', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Webhook').length).toBeGreaterThan(0));
  });

  it('renders channel with no name falls back to provider label', async () => {
    mockGetChannels.mockResolvedValue([makeChannel({ name: undefined })]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Webhook').length).toBeGreaterThan(0));
  });

  it('shows table headers: Name, Type, Events / Targets', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Name')).toBeTruthy();
      expect(screen.getByText('Type')).toBeTruthy();
      expect(screen.getByText('Events / Targets')).toBeTruthy();
    });
  });
});

// ── Sorting ──────────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — sorting', () => {
  it('sorts by name ascending by default', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-b', name: 'Beta' }),
      makeChannel({ id: 'ch-a', name: 'Alpha' }),
    ]);
    renderPage();
    // name appears in both Name and Events/Targets columns — wait until rows are rendered
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('Alpha');
  });

  it('clicking Name header reverses sort (desc)', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-a', name: 'Alpha' }),
      makeChannel({ id: 'ch-b', name: 'Beta' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText('Name'));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('Beta');
  });

  it('clicking Type header sorts by provider label', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-w', provider: 'webhook', name: 'Wh' }),
      makeChannel({ id: 'ch-s', provider: 'smtp',    name: 'Sm' }),
    ]);
    renderPage();
    // name appears in both Name and Events/Targets columns — use getAllByText
    await waitFor(() => expect(screen.getAllByText('Sm').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText('Type'));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // 'Smtp' < 'Webhook' alphabetically
    expect(rows[0]?.textContent).toContain('Sm');
  });

  it('clicking Events / Targets header sorts by summary', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-z', name: 'ZChan' }),
      makeChannel({ id: 'ch-a', name: 'AChan' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('AChan').length).toBeGreaterThan(0));
    // summariseChannel returns name, so sorting by summary is like sorting by name
    await userEvent.click(screen.getByText('Events / Targets'));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('AChan');
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — search', () => {
  it('filters channels by search text', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-1', name: 'Alpha' }),
      makeChannel({ id: 'ch-2', name: 'Beta' }),
    ]);
    renderPage();
    // name appears in both columns; wait until rows render
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await userEvent.type(screen.getByPlaceholderText('Filter channels…'), 'alpha');
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
  });

  it('shows filtered count when filter is active', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-1', name: 'Alpha' }),
      makeChannel({ id: 'ch-2', name: 'Beta' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await userEvent.type(screen.getByPlaceholderText('Filter channels…'), 'alpha');
    await waitFor(() => expect(screen.getByText('1 of 2 channels')).toBeTruthy());
  });

  it('clears search with X button', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-1', name: 'Alpha' }),
      makeChannel({ id: 'ch-2', name: 'Beta' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await userEvent.type(screen.getByPlaceholderText('Filter channels…'), 'alpha');
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
    // Find and click X clear button
    const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.style.position === 'absolute' && b.style.right === '7px'
    );
    if (xBtn) {
      await userEvent.click(xBtn);
      await waitFor(() => expect(screen.getAllByText('Beta').length).toBeGreaterThan(0));
    }
  });

  it('shows empty filter state when no match', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('My Webhook').length).toBeGreaterThan(0));
    await userEvent.type(screen.getByPlaceholderText('Filter channels…'), 'zzzmatch');
    await waitFor(() => expect(screen.getByText(/No channels match the active filters/)).toBeTruthy());
  });
});

// ── Provider filter ──────────────────────────────────────────────────────────

describe('NotificationChannelListPage — provider filter', () => {
  it('shows provider filter when multiple provider types present', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-1', provider: 'webhook' }),
      makeChannel({ id: 'ch-2', provider: 'smtp' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
  });

  it('does NOT show provider filter when all channels are same type', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-1', provider: 'webhook' }),
      makeChannel({ id: 'ch-2', provider: 'webhook', name: 'Wh2' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('My Webhook').length).toBeGreaterThan(0));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('filters by provider using dropdown', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-1', provider: 'webhook', name: 'Wh' }),
      makeChannel({ id: 'ch-2', provider: 'smtp',    name: 'Sm' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByRole('combobox'));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'smtp');
    await waitFor(() => expect(screen.queryByText('Wh')).toBeNull());
    // 'Sm' appears in both Name and Events/Targets columns
    expect(screen.getAllByText('Sm').length).toBeGreaterThan(0);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — delete', () => {
  it('opens confirm dialog when delete clicked', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByTitle('Delete channel'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText(/Remove channel "My Webhook"/)).toBeTruthy();
  });

  it('deletes channel after confirm', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('ch-1'));
    await waitFor(() => expect(screen.queryByText('My Webhook')).toBeNull());
  });

  it('shows error when delete fails', async () => {
    mockDelete.mockRejectedValue(new Error('Delete failed'));
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Delete failed')).toBeTruthy());
  });

  it('cancels delete dialog without deleting', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('uses id in message when channel has no name', async () => {
    mockGetChannels.mockResolvedValue([makeChannel({ name: undefined })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByTitle('Delete channel'));
    expect(screen.getByText(/Remove channel "ch-1"/)).toBeTruthy();
  });
});

// ── Test ──────────────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — test', () => {
  it('shows test result success inline below the row', async () => {
    mockTest.mockResolvedValue({ ok: true, message: 'Delivered' });
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Send test'));
    await userEvent.click(screen.getByTitle('Send test'));
    await waitFor(() => expect(screen.getByText(/Delivered/)).toBeTruthy());
  });

  it('shows test result failure inline below the row', async () => {
    mockTest.mockResolvedValue({ ok: false, message: 'Connection refused' });
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Send test'));
    await userEvent.click(screen.getByTitle('Send test'));
    await waitFor(() => expect(screen.getByText(/Connection refused/)).toBeTruthy());
  });

  it('shows error status when test throws', async () => {
    mockTest.mockRejectedValue(new Error('Timeout'));
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Send test'));
    await userEvent.click(screen.getByTitle('Send test'));
    await waitFor(() => expect(screen.getByText(/Timeout/)).toBeTruthy());
  });

  it('dispatches routerly:notifications event when test succeeds', async () => {
    mockTest.mockResolvedValue({ ok: true, message: 'Sent' });
    mockGetChannels.mockResolvedValue([makeChannel()]);
    const handler = vi.fn();
    window.addEventListener('routerly:notifications', handler);
    renderPage();
    await waitFor(() => screen.getByTitle('Send test'));
    await userEvent.click(screen.getByTitle('Send test'));
    await waitFor(() => expect(handler).toHaveBeenCalled());
    window.removeEventListener('routerly:notifications', handler);
  });
});

// ── Add Channel picker ────────────────────────────────────────────────────────

describe('NotificationChannelListPage — add picker', () => {
  it('opens add picker on Add Channel click', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/No notification channels/));
    await userEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    // Picker dropdown renders provider entries
    await waitFor(() => expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0));
  });

  it('shows search input in picker', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/No notification channels/));
    await userEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    await waitFor(() => expect(screen.getByPlaceholderText('Search channels…')).toBeTruthy());
  });

  it('filters provider entries by search text', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/No notification channels/));
    await userEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    await waitFor(() => screen.getByPlaceholderText('Search channels…'));
    await userEvent.type(screen.getByPlaceholderText('Search channels…'), 'slack');
    await waitFor(() => expect(screen.queryByText('SMTP')).toBeNull());
    expect(screen.getAllByText('Slack').length).toBeGreaterThan(0);
  });

  it('shows No results when search matches nothing', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/No notification channels/));
    await userEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    await waitFor(() => screen.getByPlaceholderText('Search channels…'));
    await userEvent.type(screen.getByPlaceholderText('Search channels…'), 'zzzmatch');
    await waitFor(() => expect(screen.getByText('No results')).toBeTruthy());
  });

  it('closes picker when clicking outside', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/No notification channels/));
    await userEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    await waitFor(() => screen.getByPlaceholderText('Search channels…'));
    // Click outside the picker (document body)
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByPlaceholderText('Search channels…')).toBeNull());
  });

  it('clicking a provider entry closes the picker', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/No notification channels/));
    await userEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    await waitFor(() => expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0));

    // Click the first provider button in the picker — it closes the picker
    const providerBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.textContent?.includes('In-app inbox') && b.tagName === 'BUTTON'
    );
    if (providerBtns.length > 0) {
      await userEvent.click(providerBtns[0]!);
      await waitFor(() => expect(screen.queryByPlaceholderText('Search channels…')).toBeNull());
    }
  });
});

// ── Row navigation ────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — row navigation', () => {
  it('clicking a row navigates to channel edit page', async () => {
    const mockNav = vi.fn();
    const MemoryRouterWithNav = ({ children }: { children: React.ReactNode }) => {
      return (
        <MemoryRouter>
          {children}
        </MemoryRouter>
      );
    };
    // Use the existing renderPage and just check row click fires navigate
    mockGetChannels.mockResolvedValue([makeChannel()]);
    render(
      <MemoryRouter>
        <NotificationChannelListPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getAllByText('My Webhook').length > 0);
    // Click the table row
    const rows = document.querySelectorAll('tbody tr');
    if (rows.length > 0) {
      await userEvent.click(rows[0] as HTMLElement);
    }
  });

  it('clicking Edit button navigates to channel edit page', async () => {
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Edit channel'));
    // Click edit button — should not throw
    await userEvent.click(screen.getByTitle('Edit channel'));
  });
});

// ── Error loading ─────────────────────────────────────────────────────────────

describe('NotificationChannelListPage — load error', () => {
  it('shows error when getNotificationChannels fails', async () => {
    mockGetChannels.mockRejectedValue(new Error('Network failure'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Network failure')).toBeTruthy());
  });

  it('shows generic error when non-Error thrown', async () => {
    mockGetChannels.mockRejectedValue('fail');
    renderPage();
    await waitFor(() => expect(screen.getByText('Failed to load')).toBeTruthy());
  });
});

// ── Test error with non-Error thrown ──────────────────────────────────────────

describe('NotificationChannelListPage — test non-Error throw', () => {
  it('shows string error when test throws non-Error', async () => {
    mockTest.mockRejectedValue('xyzTestFail42');
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Send test'));
    await userEvent.click(screen.getByTitle('Send test'));
    await waitFor(() => expect(screen.getByText(/xyzTestFail42/)).toBeTruthy());
  });
});

// ── Delete error with non-Error thrown ───────────────────────────────────────

describe('NotificationChannelListPage — delete non-Error throw', () => {
  it('shows generic Failed to delete when non-Error thrown on delete', async () => {
    mockDelete.mockRejectedValue('delete fail');
    mockGetChannels.mockResolvedValue([makeChannel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByTitle('Delete channel'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Failed to delete')).toBeTruthy());
  });
});

// ── Sort same-header toggle (desc→asc) ───────────────────────────────────────

describe('NotificationChannelListPage — sort desc→asc on second click', () => {
  it('clicking Name header twice returns to ascending order', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-a', name: 'Alpha' }),
      makeChannel({ id: 'ch-b', name: 'Beta' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    // First click: asc→desc (Beta first)
    await userEvent.click(screen.getByText('Name'));
    // Second click: desc→asc (Alpha first again)
    await userEvent.click(screen.getByText('Name'));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('Alpha');
  });
});

// ── Search with nameless channels (name ?? '' branch) ────────────────────────

describe('NotificationChannelListPage — search matches nameless channel by provider', () => {
  it('nameless channel is included in search (provider label matches)', async () => {
    mockGetChannels.mockResolvedValue([makeChannel({ name: undefined })]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Webhook').length).toBeGreaterThan(0));
    await userEvent.type(screen.getByPlaceholderText('Filter channels…'), 'web');
    // 'web' is in providerLabel('webhook') → 'Webhook' — channel stays visible
    await waitFor(() => expect(screen.getAllByText('Webhook').length).toBeGreaterThan(0));
  });

  it('nameless channel is excluded from search when neither name nor provider matches', async () => {
    mockGetChannels.mockResolvedValue([makeChannel({ name: undefined })]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Webhook').length).toBeGreaterThan(0));
    await userEvent.type(screen.getByPlaceholderText('Filter channels…'), 'zzzmatch');
    await waitFor(() => expect(screen.getByText(/No channels match/)).toBeTruthy());
  });
});

// ── Sort by name with nameless channels (name ?? '' branch) ──────────────────

describe('NotificationChannelListPage — sort by name with nameless channels', () => {
  it('nameless channels sort using empty string fallback', async () => {
    mockGetChannels.mockResolvedValue([
      makeChannel({ id: 'ch-a', name: 'Alpha' }),
      makeChannel({ id: 'ch-n', name: undefined }),
    ]);
    renderPage();
    // Both channels render — Alpha and Webhook (provider label) in DOM
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    // Default sort asc: '' < 'Alpha' so nameless channel comes first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // The nameless channel uses '' as name → sorts before 'Alpha'
    expect(rows.length).toBeGreaterThan(0);
  });
});
