/**
 * Tests for the notification channel pages:
 * - NotificationChannelListPage (list, filter, sort, delete, test-button, row-click)
 * - NotificationChannelEditPage (pre-fills non-secrets, leaves secrets empty, save, test)
 * - NotificationChannelCreatePage (create flow)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../api', () => ({
  getNotificationChannels:  vi.fn(),
  getNotificationChannel:   vi.fn(),
  createNotificationChannel: vi.fn(),
  updateNotificationChannel: vi.fn(),
  deleteNotificationChannel: vi.fn(),
  testNotificationChannel:  vi.fn(),
  getRoles: vi.fn(),
  getUsers: vi.fn(),
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

import {
  getNotificationChannels,
  getNotificationChannel,
  createNotificationChannel,
  updateNotificationChannel,
  deleteNotificationChannel,
  testNotificationChannel,
  getRoles,
  getUsers,
} from '../api';

import { NotificationChannelListPage } from './NotificationChannelListPage';
import { NotificationChannelEditPage } from './NotificationChannelEditPage';
import { NotificationChannelCreatePage } from './NotificationChannelCreatePage';

const smtpChannel = {
  id: 'ch1',
  provider: 'smtp',
  name: 'My SMTP',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  fromAddress: 'no-reply@example.com',
  username: 'user',
  password: '********',  // masked by service
};

const dashboardChannel = {
  id: 'ch2',
  provider: 'dashboard',
  name: 'Inbox',
};

const webhookChannel = {
  id: 'ch3',
  provider: 'webhook',
  name: 'My Webhook',
  url: 'https://example.com/hook',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRoles).mockResolvedValue([]);
  vi.mocked(getUsers).mockResolvedValue([]);
});

// ── List page ─────────────────────────────────────────────────────────────────

describe('NotificationChannelListPage', () => {
  it('renders empty state when no channels', async () => {
    vi.mocked(getNotificationChannels).mockResolvedValue([]);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no notification channels/i)).toBeInTheDocument());
  });

  it('renders channel rows with name, type, and summary', async () => {
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel, dashboardChannel] as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('My SMTP')).toBeInTheDocument());
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getAllByText(/SMTP/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
  });

  it('falls back to the provider label for a channel with no name', async () => {
    const unnamed = { id: 'ch9', provider: 'webhook', url: 'https://x.com/h' };
    vi.mocked(getNotificationChannels).mockResolvedValue([unnamed] as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText('(unnamed)')).toBeNull());
    // The unnamed channel shows the provider label (Webhook) in both Name and Type cells.
    expect(screen.getAllByText(/Webhook/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows provider picker when Add Channel clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([]);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText(/Add Channel/i));
    await user.click(screen.getByText(/Add Channel/i));
    expect(screen.getByText(/Dashboard \(in-app inbox\)/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP/i)).toBeInTheDocument();
  });

  it('filters channels by name search', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel, dashboardChannel] as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('My SMTP'));
    const searchInput = screen.getByPlaceholderText('Filter channels…');
    await user.type(searchInput, 'smtp');
    expect(screen.getByText('My SMTP')).toBeInTheDocument();
    expect(screen.queryByText('Inbox')).toBeNull();
  });

  it('shows no-match empty state when filter has no results', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel] as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('My SMTP'));
    await user.type(screen.getByPlaceholderText('Filter channels…'), 'zzznomatch');
    await waitFor(() => expect(screen.getByText(/no channels match/i)).toBeInTheDocument());
  });

  it('sorts by name column on header click', async () => {
    const user = userEvent.setup();
    const alpha = { id: 'a', provider: 'webhook', name: 'Alpha', url: 'https://a.com' };
    const zulu  = { id: 'z', provider: 'webhook', name: 'Zulu',  url: 'https://z.com' };
    vi.mocked(getNotificationChannels).mockResolvedValue([zulu, alpha] as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('Zulu'));
    // Default sort is by name asc — Alpha should already be first
    const rowsBefore = screen.getAllByRole('row');
    expect(rowsBefore[1]).toHaveTextContent('Alpha');
    // Click Name header to reverse to desc — Zulu should be first
    await user.click(screen.getByText('Name'));
    const rowsAfter = screen.getAllByRole('row');
    expect(rowsAfter[1]).toHaveTextContent('Zulu');
  });

  it('delete confirm + cancel flow leaves channel in list', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel] as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('My SMTP'));
    const trashBtns = screen.getAllByTitle('Delete channel');
    await user.click(trashBtns[0]!);
    expect(screen.getByText(/Delete/i)).toBeInTheDocument();
    await user.click(screen.getByText('Cancel'));
    expect(screen.getByText('My SMTP')).toBeInTheDocument();
  });

  it('delete confirm calls deleteNotificationChannel and removes row', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel] as any);
    vi.mocked(deleteNotificationChannel).mockResolvedValue(undefined as any);
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('My SMTP'));
    const trashBtns = screen.getAllByTitle('Delete channel');
    await user.click(trashBtns[0]!);
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    await user.click(deleteBtn);
    await waitFor(() => expect(deleteNotificationChannel).toHaveBeenCalledWith('ch1'));
    expect(screen.queryByText('My SMTP')).toBeNull();
  });

  it('Test button calls testNotificationChannel and shows result', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel] as any);
    vi.mocked(testNotificationChannel).mockResolvedValue({ ok: true, message: 'Test sent' });
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('My SMTP'));
    const testBtns = screen.getAllByTitle('Send test');
    await user.click(testBtns[0]!);
    await waitFor(() => expect(testNotificationChannel).toHaveBeenCalledWith('ch1', ''));
    expect(await screen.findByText(/Test sent/i)).toBeInTheDocument();
  });

  it('shows Test button for dashboard provider', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([dashboardChannel] as any);
    vi.mocked(testNotificationChannel).mockResolvedValue({ ok: true, message: 'Test notification delivered to the in-app inbox.' });
    render(<MemoryRouter><NotificationChannelListPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('Inbox'));
    const testBtn = screen.getByTitle('Send test');
    await user.click(testBtn);
    await waitFor(() => expect(testNotificationChannel).toHaveBeenCalledWith('ch2', ''));
    await waitFor(() => expect(screen.getByText(/Test notification delivered/i)).toBeInTheDocument());
  });

  it('clicking a row navigates to the edit route', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannels).mockResolvedValue([smtpChannel] as any);
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    let navigatedTo = '';
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationChannelListPage />} />
          <Route path="/dashboard/settings/notifications/:id" element={<div>EditPage</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText('My SMTP'));
    // Click on the name cell (part of the row)
    await user.click(screen.getByText('My SMTP'));
    await waitFor(() => {
      navigatedTo = window.location.pathname;
      expect(screen.getByText('EditPage')).toBeInTheDocument();
    });
    void navigatedTo;
  });
});

// ── Edit page ─────────────────────────────────────────────────────────────────

describe('NotificationChannelEditPage', () => {
  function renderEdit(id = 'ch1') {
    return render(
      <MemoryRouter initialEntries={[`/settings/notifications/${id}`]}>
        <Routes>
          <Route path="/settings/notifications/:id" element={<NotificationChannelEditPage />} />
          <Route path="/dashboard/settings/notifications" element={<div>ListPage</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('pre-fills non-secret fields from fetched channel', async () => {
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    renderEdit();
    await waitFor(() => {
      const hostInput = screen.getByDisplayValue('smtp.example.com');
      expect(hostInput).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('no-reply@example.com')).toBeInTheDocument();
  });

  it('leaves secret fields empty (password not pre-filled)', async () => {
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    renderEdit();
    await waitFor(() => screen.getByDisplayValue('smtp.example.com'));
    const pwInputs = screen.getAllByPlaceholderText('Leave blank to keep current');
    expect(pwInputs.length).toBeGreaterThan(0);
    pwInputs.forEach(input => {
      expect((input as HTMLInputElement).value).toBe('');
    });
  });

  it('calls updateNotificationChannel with only changed non-secret fields when secret left empty', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    vi.mocked(updateNotificationChannel).mockResolvedValue({ ...smtpChannel, host: 'new.host.com' } as any);
    renderEdit();
    await waitFor(() => screen.getByDisplayValue('smtp.example.com'));

    const hostInput = screen.getByDisplayValue('smtp.example.com');
    await user.clear(hostInput);
    await user.type(hostInput, 'new.host.com');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(updateNotificationChannel).toHaveBeenCalledWith(
      'ch1',
      expect.objectContaining({ host: 'new.host.com' }),
    ));
    const patch = vi.mocked(updateNotificationChannel).mock.calls[0]![1];
    expect(patch['password']).toBeUndefined();
  });

  it('sends new password when a non-empty password is typed', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    vi.mocked(updateNotificationChannel).mockResolvedValue(smtpChannel as any);
    renderEdit();
    await waitFor(() => screen.getByDisplayValue('smtp.example.com'));

    const pwInputs = screen.getAllByPlaceholderText('Leave blank to keep current');
    await user.type(pwInputs[0]!, 'newpassword123');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(updateNotificationChannel).toHaveBeenCalled());
    const patch = vi.mocked(updateNotificationChannel).mock.calls[0]![1];
    expect(patch['password']).toBe('newpassword123');
  });

  it('shows Send Test button for smtp channel', async () => {
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    renderEdit();
    await waitFor(() => screen.getByDisplayValue('smtp.example.com'));
    expect(screen.getByRole('button', { name: /Send Test/i })).toBeInTheDocument();
  });

  it('forwards the typed recipient to testNotificationChannel for an email channel', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannel).mockResolvedValue(smtpChannel as any);
    vi.mocked(testNotificationChannel).mockResolvedValue({ ok: true, message: 'Sent' });
    renderEdit();
    await waitFor(() => screen.getByDisplayValue('smtp.example.com'));
    const recipient = screen.getByPlaceholderText('recipient@example.com');
    await user.type(recipient, 'dev@example.com');
    await user.click(screen.getByRole('button', { name: /Send Test/i }));
    await waitFor(() => expect(testNotificationChannel).toHaveBeenCalledWith('ch1', 'dev@example.com'));
  });

  it('does not render a recipient input for dashboard channel', async () => {
    vi.mocked(getNotificationChannel).mockResolvedValue(dashboardChannel as any);
    renderEdit('ch2');
    await waitFor(() => expect(screen.getByPlaceholderText('Label for this channel')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('recipient@example.com')).not.toBeInTheDocument();
  });

  it('shows Send Test section for dashboard channel', async () => {
    vi.mocked(getNotificationChannel).mockResolvedValue(dashboardChannel as any);
    renderEdit('ch2');
    await waitFor(() => expect(screen.getByPlaceholderText('Label for this channel')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Send Test/i })).toBeInTheDocument();
  });

  it('Send Test calls testNotificationChannel and shows result', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationChannel).mockResolvedValue(webhookChannel as any);
    vi.mocked(testNotificationChannel).mockResolvedValue({ ok: false, message: 'Connection refused' });
    renderEdit('ch3');
    await waitFor(() => screen.getByRole('button', { name: /Send Test/i }));
    await user.click(screen.getByRole('button', { name: /Send Test/i }));
    await waitFor(() => expect(testNotificationChannel).toHaveBeenCalledWith('ch3', ''));
    expect(await screen.findByText(/Connection refused/i)).toBeInTheDocument();
  });
});

// ── Create page ───────────────────────────────────────────────────────────────

describe('NotificationChannelCreatePage', () => {
  function renderCreate(provider?: string) {
    const path = provider
      ? `/settings/notifications/new?provider=${provider}`
      : '/settings/notifications/new';
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/notifications/new" element={<NotificationChannelCreatePage />} />
          <Route path="/dashboard/settings/notifications/:id" element={<div>EditPage</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows provider picker when no provider param', async () => {
    renderCreate();
    expect(screen.getByText(/Choose a channel type/i)).toBeInTheDocument();
    expect(screen.getByText(/Dashboard \(in-app inbox\)/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP/i)).toBeInTheDocument();
  });

  it('skips provider picker when ?provider=dashboard given', async () => {
    renderCreate('dashboard');
    await waitFor(() => expect(screen.queryByText(/Choose a channel type/i)).toBeNull());
    expect(screen.getByText(/New Dashboard/i)).toBeInTheDocument();
  });

  it('shows smtp form fields when smtp provider selected', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByText(/^SMTP$/));
    expect(screen.getByPlaceholderText('smtp.example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('noreply@example.com')).toBeInTheDocument();
  });

  it('calls createNotificationChannel on submit', async () => {
    const user = userEvent.setup();
    vi.mocked(createNotificationChannel).mockResolvedValue({ id: 'new1', provider: 'dashboard' } as any);
    renderCreate('dashboard');
    await waitFor(() => screen.getByRole('button', { name: /create channel/i }));
    await user.click(screen.getByRole('button', { name: /create channel/i }));
    await waitFor(() => expect(createNotificationChannel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'dashboard' }),
    ));
  });
});
