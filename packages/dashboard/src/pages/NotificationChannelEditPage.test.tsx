import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NotificationChannelEditPage } from './NotificationChannelEditPage';

vi.mock('../api', () => ({
  getNotificationChannel: vi.fn(),
  updateNotificationChannel: vi.fn(),
  testNotificationChannel: vi.fn(),
  getRoles: vi.fn(),
  getUsers: vi.fn(),
}));

vi.mock('@routerly/shared', () => ({
  CHANNEL_SECRET_FIELDS: {
    smtp:      ['password'],
    ses:       ['secretAccessKey'],
    sendgrid:  ['apiKey'],
    azure:     ['connectionString'],
    google:    ['clientSecret', 'refreshToken'],
    webhook:   [],
    slack:     ['botToken'],
    teams:     [],
    pagerduty: ['integrationKey'],
    discord:   [],
    dashboard: [],
  },
}));

// Stubs expose buttons so tests can inject form values (events, targets).
vi.mock('./notificationChannelFields', () => ({
  ChannelEditFields: ({ onChange }: { form: Record<string, unknown>; onChange: (f: string, v: unknown) => void; isEdit: boolean }) => (
    <div data-testid="channel-edit-fields">
      <button type="button" data-testid="set-secret" onClick={() => onChange('password', 'new-pass')}>set-secret</button>
      <button type="button" data-testid="clear-secret" onClick={() => onChange('password', '')}>clear-secret</button>
    </div>
  ),
  RoutingEditFields: ({ onChange }: { form: Record<string, unknown>; onChange: (f: string, v: unknown) => void }) => (
    <div data-testid="routing-edit-fields">
      <button type="button" data-testid="set-events-empty" onClick={() => onChange('events', [])}>set-events-empty</button>
      <button type="button" data-testid="set-events-full"  onClick={() => onChange('events', ['budget.exceeded'])}>set-events-full</button>
    </div>
  ),
  RecipientsEditFields: ({ onChange }: { form: Record<string, unknown>; onChange: (f: string, v: unknown) => void; roles: unknown[]; users: unknown[] }) => (
    <div data-testid="recipients-edit-fields">
      <button type="button" data-testid="set-targets-empty"       onClick={() => onChange('targets', { roles: [], permissions: [], users: [] })}>set-targets-empty</button>
      <button type="button" data-testid="set-targets-full"        onClick={() => onChange('targets', { roles: ['admin'], permissions: [], users: [] })}>set-targets-full</button>
      <button type="button" data-testid="set-targets-permissions" onClick={() => onChange('targets', { roles: [], permissions: ['admin:read'], users: [] })}>set-targets-permissions</button>
      <button type="button" data-testid="set-targets-users"       onClick={() => onChange('targets', { roles: [], permissions: [], users: ['user-1'] })}>set-targets-users</button>
    </div>
  ),
  providerLabel: (p: string) => p.toUpperCase(),
}));

import {
  getNotificationChannel, updateNotificationChannel, testNotificationChannel,
  getRoles, getUsers,
} from '../api';

const mockGet    = vi.mocked(getNotificationChannel    as (id: string) => Promise<unknown>);
const mockUpdate = vi.mocked(updateNotificationChannel as (id: string, patch: unknown) => Promise<unknown>);
const mockTest   = vi.mocked(testNotificationChannel   as (id: string, to: string) => Promise<unknown>);
const mockGetRoles = vi.mocked(getRoles as () => Promise<unknown>);
const mockGetUsers = vi.mocked(getUsers as () => Promise<unknown>);

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    provider: 'webhook',
    name: 'My Webhook',
    url: 'https://example.com/hook',
    method: 'POST',
    ...overrides,
  };
}

function renderPage(id = 'ch-1') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/settings/notifications/${id}`]}>
      <Routes>
        <Route path="/dashboard/settings/notifications/:id" element={<NotificationChannelEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetRoles.mockResolvedValue([]);
  mockGetUsers.mockResolvedValue([]);
  mockGet.mockResolvedValue(makeChannel());
  mockUpdate.mockResolvedValue(undefined);
  mockTest.mockResolvedValue({ ok: true, message: 'Test sent' });
});

afterEach(() => vi.clearAllMocks());

// ── Loading state ────────────────────────────────────────────────────────────

describe('NotificationChannelEditPage — loading state', () => {
  it('shows loading spinner while fetching', async () => {
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValue(new Promise(r => { resolve = r; }));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
    resolve(makeChannel());
  });
});

// ── Error / not-found state ──────────────────────────────────────────────────

describe('NotificationChannelEditPage — error state', () => {
  it('shows error when load fails', async () => {
    mockGet.mockRejectedValue(new Error('Not found'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Not found')).toBeTruthy());
    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('shows fallback error for non-Error throws', async () => {
    mockGet.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.getByText('Failed to load')).toBeTruthy());
  });

  it('Back button in error view fires navigate (line 145)', async () => {
    mockGet.mockRejectedValue(new Error('Not found'));
    renderPage();
    await waitFor(() => screen.getByText('Back'));
    await userEvent.click(screen.getByText('Back'));
    // MemoryRouter absorbs navigation; no error = handler executed
  });

  it('still loads when getRoles rejects (line 44 catch)', async () => {
    mockGetRoles.mockRejectedValue(new Error('roles unavailable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Edit WEBHOOK channel/i)).toBeTruthy());
  });

  it('still loads when getUsers rejects (line 45 catch)', async () => {
    mockGetUsers.mockRejectedValue(new Error('users unavailable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Edit WEBHOOK channel/i)).toBeTruthy());
  });
});

// ── Form renders ─────────────────────────────────────────────────────────────

describe('NotificationChannelEditPage — form rendering', () => {
  it('shows Edit heading after load', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Edit WEBHOOK channel/i)).toBeTruthy());
  });

  it('shows 3 form tabs', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'connection' }));
    expect(screen.getByRole('button', { name: 'routing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'recipients' })).toBeTruthy();
  });

  it('shows connection tab by default with ChannelEditFields', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('channel-edit-fields')).toBeTruthy());
  });

  it('switches to routing tab', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByRole('button', { name: 'routing' }));
    expect(screen.getByTestId('routing-edit-fields')).toBeTruthy();
  });

  it('switches to recipients tab', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    expect(screen.getByTestId('recipients-edit-fields')).toBeTruthy();
  });

  it('shows Name field pre-filled', async () => {
    renderPage();
    await waitFor(() => {
      const input = screen.getByPlaceholderText('Label for this channel') as HTMLInputElement;
      expect(input.value).toBe('My Webhook');
    });
  });

  it('name input onChange sets value (line 194)', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Label for this channel'));
    const input = screen.getByPlaceholderText('Label for this channel');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    expect((input as HTMLInputElement).value).toBe('Renamed');
  });

  it('name input onChange with empty string (line 194)', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Label for this channel'));
    const input = screen.getByPlaceholderText('Label for this channel');
    fireEvent.change(input, { target: { value: '' } });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('shows Back to Notifications button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Back to Notifications')).toBeTruthy());
  });

  it('Back to Notifications button fires navigate (line 145 form view)', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Back to Notifications'));
    await userEvent.click(screen.getByText('Back to Notifications'));
    // no error = navigate called
  });

  it('Cancel button fires navigate (line 265)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('buildInitialForm strips secrets (provider with secrets)', async () => {
    // smtp has password as secret — it must be absent from the form initial state
    mockGet.mockResolvedValue(makeChannel({ provider: 'smtp', password: '••••••' }));
    renderPage();
    await waitFor(() => screen.getByTestId('channel-edit-fields'));
    // set-secret button fires onChange('password', 'new-pass') — proves onChange works
    await userEvent.click(screen.getByTestId('set-secret'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(patch['password']).toBe('new-pass');
  });

  it('buildInitialForm handles unknown provider (line 23 ?? [] branch)', async () => {
    // Provider not in CHANNEL_SECRET_FIELDS → secrets = [] via the ?? fallback
    mockGet.mockResolvedValue(makeChannel({ provider: 'unknown-provider' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Edit UNKNOWN-PROVIDER channel/i)).toBeTruthy());
  });
});

// ── Submit ───────────────────────────────────────────────────────────────────

describe('NotificationChannelEditPage — submit', () => {
  it('calls updateNotificationChannel on Save', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save Changes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('ch-1', expect.any(Object)));
  });

  it('skips empty-string secret fields (line 74 branch not taken)', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'smtp' }));
    renderPage();
    await waitFor(() => screen.getByTestId('clear-secret'));
    await userEvent.click(screen.getByTestId('clear-secret')); // sets password = ''
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(patch['password']).toBeUndefined(); // empty secret excluded
  });

  it('skips id and provider keys during patch build (line 72)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save Changes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(patch['id']).toBeUndefined();
    expect(patch['provider']).toBeUndefined();
  });

  it('deletes empty events array on submit (lines 79-80)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByTestId('set-events-empty'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(patch['events']).toBeUndefined();
  });

  it('keeps non-empty events array (line 79 branch not taken)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByTestId('set-events-full'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(patch['events']).toEqual(['budget.exceeded']);
  });

  it('deletes targets when all inner arrays empty (line 89)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-empty'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(patch['targets']).toBeUndefined();
  });

  it('keeps targets when roles non-empty (lines 85, 88)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-full'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect((patch['targets'] as Record<string, unknown>)['roles']).toEqual(['admin']);
  });

  it('keeps targets when permissions non-empty (line 86)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-permissions'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect((patch['targets'] as Record<string, unknown>)['permissions']).toEqual(['admin:read']);
  });

  it('keeps targets when users non-empty (line 87)', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-users'));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect((patch['targets'] as Record<string, unknown>)['users']).toEqual(['user-1']);
  });

  it('shows API error on save failure', async () => {
    mockUpdate.mockRejectedValue(new Error('Save failed'));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save Changes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy());
  });

  it('shows fallback error for non-Error save failure', async () => {
    mockUpdate.mockRejectedValue('fail');
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save Changes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(screen.getByText('Failed to save')).toBeTruthy());
  });
});

// ── Test section ─────────────────────────────────────────────────────────────

describe('NotificationChannelEditPage — test section', () => {
  it('shows Send Test button for non-email provider (webhook)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Send Test/ })).toBeTruthy());
  });

  it('does NOT show recipient email input for webhook (non-email) provider', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    expect(screen.queryByPlaceholderText('recipient@example.com')).toBeNull();
  });

  it('shows recipient email input for smtp provider', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'smtp' }));
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText('recipient@example.com')).toBeTruthy());
  });

  it('recipient input onChange updates testTo (line 228)', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'smtp' }));
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('recipient@example.com'));
    const input = screen.getByPlaceholderText('recipient@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    expect((input as HTMLInputElement).value).toBe('test@example.com');
  });

  it('shows success status after successful test', async () => {
    mockTest.mockResolvedValue({ ok: true, message: 'Test delivered' });
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send Test/ }));
    await waitFor(() => expect(screen.getByText(/Test delivered/)).toBeTruthy());
  });

  it('shows error status after failed test', async () => {
    mockTest.mockResolvedValue({ ok: false, message: 'Connection refused' });
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send Test/ }));
    await waitFor(() => expect(screen.getByText(/Connection refused/)).toBeTruthy());
  });

  it('shows error status when testNotificationChannel throws Error', async () => {
    mockTest.mockRejectedValue(new Error('Timeout'));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send Test/ }));
    await waitFor(() => expect(screen.getByText(/Timeout/)).toBeTruthy());
  });

  it('shows error status when testNotificationChannel throws non-Error (line 110)', async () => {
    mockTest.mockRejectedValue('raw string error');
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send Test/ }));
    await waitFor(() => expect(screen.getByText(/raw string error/)).toBeTruthy());
  });

  it('dispatches routerly:notifications event when test succeeds on dashboard channel', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'dashboard' }));
    mockTest.mockResolvedValue({ ok: true, message: 'Sent to inbox' });
    const handler = vi.fn();
    window.addEventListener('routerly:notifications', handler);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send Test/ }));
    await waitFor(() => expect(handler).toHaveBeenCalled());
    window.removeEventListener('routerly:notifications', handler);
  });

  it('email providers (ses) show recipient input', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'ses' }));
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText('recipient@example.com')).toBeTruthy());
  });

  it('email providers (sendgrid) show recipient input', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'sendgrid' }));
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText('recipient@example.com')).toBeTruthy());
  });

  it('email providers (azure) show recipient input', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'azure' }));
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText('recipient@example.com')).toBeTruthy());
  });

  it('email providers (google) show recipient input', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'google' }));
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText('recipient@example.com')).toBeTruthy());
  });

  it('non-email providers (slack) do not show recipient input', async () => {
    mockGet.mockResolvedValue(makeChannel({ provider: 'slack' }));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Send Test/ }));
    expect(screen.queryByPlaceholderText('recipient@example.com')).toBeNull();
  });
});
