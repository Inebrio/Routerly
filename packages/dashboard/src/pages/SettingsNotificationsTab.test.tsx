/**
 * Tests for SettingsNotificationsTab — U5 additions:
 * - dashboard channel type (no secrets)
 * - events multi-select
 * - targets multi-select (roles, permissions, users)
 * - collapsed summary shows events + targets
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SettingsNotificationsTab } from './SettingsPage';

// ponytail: mock at module level — only what the component calls
vi.mock('../api', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getRoles: vi.fn(),
  getUsers: vi.fn(),
  testNotificationChannel: vi.fn(),
  ALL_PERMISSIONS: ['settings:read', 'settings:write'] as const,
}));

vi.mock('../components/MultiSelect', () => ({
  MultiSelect: ({ options, value, onChange, placeholder }: {
    options: Array<{ value: string; label: string }>;
    value: string[];
    onChange: (v: string[]) => void;
    placeholder: string;
  }) => (
    <div data-testid="multi-select" data-placeholder={placeholder}>
      {options.map(o => (
        <button key={o.value} data-testid={`opt-${o.value}`}
          onClick={() => onChange(value.includes(o.value) ? value.filter(v => v !== o.value) : [...value, o.value])}>
          {o.label}
        </button>
      ))}
      <span data-testid="selected">{value.join(',')}</span>
    </div>
  ),
}));

import { getSettings, updateSettings, getRoles, getUsers } from '../api';

const mockSettings = {
  port: 3000, host: '0.0.0.0', dashboardEnabled: true, defaultTimeoutMs: 30000, logLevel: 'info' as const,
  notifications: { channels: [] },
};

function setup() {
  vi.mocked(getSettings).mockResolvedValue(mockSettings);
  vi.mocked(updateSettings).mockResolvedValue(mockSettings);
  vi.mocked(getRoles).mockResolvedValue([{ id: 'admin', name: 'Admin', permissions: [], builtin: true }]);
  vi.mocked(getUsers).mockResolvedValue([{ id: 'u1', email: 'test@example.com', roleId: 'admin', projectIds: [] }]);
}

function renderTab() {
  return render(<MemoryRouter><SettingsNotificationsTab /></MemoryRouter>);
}

describe('SettingsNotificationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it('shows empty state initially', async () => {
    renderTab();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByText(/no notification channels/i)).toBeInTheDocument();
  });

  it('dashboard provider appears in Add Channel picker', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => screen.getByText(/Add Channel/i));
    await user.click(screen.getByText(/Add Channel/i));
    expect(screen.getByText(/Dashboard \(in-app inbox\)/i)).toBeInTheDocument();
  });

  it('dashboard channel shows no secret fields, has events + targets', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => screen.getByText(/Add Channel/i));
    await user.click(screen.getByText(/Add Channel/i));
    await user.click(screen.getByText(/Dashboard \(in-app inbox\)/i));

    // No password / API key fields
    expect(screen.queryByPlaceholderText(/xoxb/i)).toBeNull();
    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    // Events and targets multi-selects rendered
    const placeholders = screen.getAllByTestId('multi-select').map(el => el.dataset.placeholder ?? '');
    expect(placeholders.some(p => /all events/i.test(p))).toBe(true);
    expect(placeholders.some(p => /all roles/i.test(p))).toBe(true);
    expect(placeholders.some(p => /all users/i.test(p))).toBe(true);
  });

  it('collapsed card shows summary with events and targets text', async () => {
    // Load with a channel already having events + targets
    vi.mocked(getSettings).mockResolvedValue({
      ...mockSettings,
      notifications: {
        channels: [{
          id: 'ch1', provider: 'dashboard',
          events: ['config.model_added'],
          targets: { roles: ['admin'] },
        }],
      },
    });
    renderTab();
    await waitFor(() => screen.getByText(/Dashboard \(in-app inbox\)/i));
    // Card is collapsed (default) — summary line should show
    expect(screen.getByText(/1 event/i)).toBeInTheDocument();
    expect(screen.getByText(/1 role/i)).toBeInTheDocument();
  });

  it('empty events + targets shows "All events" and "Everyone" in summary', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...mockSettings,
      notifications: { channels: [{ id: 'ch2', provider: 'dashboard' }] },
    });
    renderTab();
    await waitFor(() => screen.getByText(/Dashboard \(in-app inbox\)/i));
    expect(screen.getByText(/All events · Everyone/i)).toBeInTheDocument();
  });

  it('strips empty events/targets on save', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => screen.getByText(/Add Channel/i));
    await user.click(screen.getByText(/Add Channel/i));
    await user.click(screen.getByText(/Dashboard \(in-app inbox\)/i));

    await user.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());

    const saved = vi.mocked(updateSettings).mock.calls[0]![0] as { notifications?: { channels?: Array<{ events?: string[]; targets?: object }> } };
    const ch = saved.notifications?.channels?.[0];
    expect(ch?.events).toBeUndefined();
    expect(ch?.targets).toBeUndefined();
  });
});
