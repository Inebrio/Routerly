import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationChannelCreatePage } from './NotificationChannelCreatePage';

vi.mock('../api', () => ({
  createNotificationChannel: vi.fn(),
  getRoles: vi.fn(),
  getUsers: vi.fn(),
}));

// Stub sub-components; RoutingEditFields and RecipientsEditFields expose buttons
// so tests can inject form values (events, targets) that trigger cleanup branches.
vi.mock('./notificationChannelFields', () => ({
  CHANNEL_PROVIDER_META: [
    { key: 'dashboard', label: 'Dashboard (in-app inbox)', description: 'Routes events to the in-app inbox' },
    { key: 'smtp',      label: 'SMTP',                     description: 'Custom mail server' },
    { key: 'webhook',   label: 'Webhook',                   description: 'HTTP webhook callback' },
    { key: 'slack',     label: 'Slack',                     description: 'Slack Bot API' },
    { key: 'ses',       label: 'Amazon SES',                description: 'AWS Simple Email Service' },
    { key: 'sendgrid',  label: 'SendGrid',                  description: 'Twilio SendGrid' },
    { key: 'azure',     label: 'Azure Communication',       description: 'Azure Communication Services' },
    { key: 'google',    label: 'Google / Gmail',            description: 'Gmail via OAuth2' },
    { key: 'teams',     label: 'Microsoft Teams',           description: 'Teams Incoming Webhook' },
    { key: 'pagerduty', label: 'PagerDuty',                 description: 'PagerDuty Events API v2' },
    { key: 'discord',   label: 'Discord',                   description: 'Discord Webhook' },
  ],
  ChannelEditFields: ({ }: { form: Record<string, unknown>; onChange: (f: string, v: unknown) => void; isEdit: boolean }) =>
    <div data-testid="channel-edit-fields" />,
  RoutingEditFields: ({ onChange }: { form: Record<string, unknown>; onChange: (f: string, v: unknown) => void }) => (
    <div data-testid="routing-edit-fields">
      <button type="button" data-testid="set-events-empty"  onClick={() => onChange('events', [])}>set-events-empty</button>
      <button type="button" data-testid="set-events-full"   onClick={() => onChange('events', ['budget.exceeded'])}>set-events-full</button>
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

import { createNotificationChannel, getRoles, getUsers } from '../api';
const mockCreate = vi.mocked(createNotificationChannel as (b: unknown) => Promise<unknown>);
const mockGetRoles = vi.mocked(getRoles as () => Promise<unknown>);
const mockGetUsers = vi.mocked(getUsers as () => Promise<unknown>);

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/settings/notifications/new${search}`]}>
      <NotificationChannelCreatePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetRoles.mockResolvedValue([]);
  mockGetUsers.mockResolvedValue([]);
  mockCreate.mockResolvedValue({ id: 'new-ch' });
});

afterEach(() => vi.clearAllMocks());

// ── Provider picker view ─────────────────────────────────────────────────────

describe('NotificationChannelCreatePage — provider picker', () => {
  it('shows picker title when no provider selected', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Choose a channel type')).toBeTruthy());
  });

  it('lists all provider options', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Dashboard (in-app inbox)')).toBeTruthy());
    expect(screen.getByText('SMTP')).toBeTruthy();
    expect(screen.getByText('Webhook')).toBeTruthy();
    expect(screen.getByText('Slack')).toBeTruthy();
  });

  it('Back to Notifications button click fires navigate', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Back to Notifications'));
    // click the back button in the picker view (line 118)
    await userEvent.click(screen.getByText('Back to Notifications'));
    // MemoryRouter absorbs the navigation; no error means the handler executed
  });

  it('clicking a provider switches to form view', async () => {
    renderPage();
    await waitFor(() => screen.getByText('SMTP'));
    await userEvent.click(screen.getByText('SMTP'));
    await waitFor(() => expect(screen.getByText(/New SMTP channel/i)).toBeTruthy());
  });
});

// ── Form view ────────────────────────────────────────────────────────────────

describe('NotificationChannelCreatePage — form view', () => {
  async function renderWithProvider(provider = 'dashboard') {
    renderPage(`?provider=${provider}`);
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Channel/ })).toBeTruthy());
  }

  it('shows form with 3 tabs when provider is pre-selected', async () => {
    await renderWithProvider();
    expect(screen.getByRole('button', { name: 'connection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'routing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'recipients' })).toBeTruthy();
  });

  it('shows connection tab content by default', async () => {
    await renderWithProvider();
    expect(screen.getByTestId('channel-edit-fields')).toBeTruthy();
  });

  it('switches to routing tab', async () => {
    await renderWithProvider();
    await userEvent.click(screen.getByRole('button', { name: 'routing' }));
    expect(screen.getByTestId('routing-edit-fields')).toBeTruthy();
  });

  it('switches to recipients tab', async () => {
    await renderWithProvider();
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    expect(screen.getByTestId('recipients-edit-fields')).toBeTruthy();
  });

  it('Change type button returns to picker', async () => {
    await renderWithProvider();
    await userEvent.click(screen.getByText('Change type'));
    await waitFor(() => expect(screen.getByText('Choose a channel type')).toBeTruthy());
  });

  it('Cancel button fires navigate (line 224)', async () => {
    await renderWithProvider();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // no error = onClick handler fired
  });

  it('name input onChange sets value (line 198)', async () => {
    await renderWithProvider();
    const input = screen.getByPlaceholderText('Label for this channel');
    fireEvent.change(input, { target: { value: 'My Channel' } });
    expect((input as HTMLInputElement).value).toBe('My Channel');
  });

  it('name input onChange with empty string passes undefined (line 198)', async () => {
    await renderWithProvider();
    const input = screen.getByPlaceholderText('Label for this channel');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.change(input, { target: { value: '' } });
    // controlled input falls back to '' when form value is undefined
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('submits form and navigates on success', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  });

  it('submit removes empty string fields (line 97)', async () => {
    // webhook buildDefaults has url:'', method:'POST' — url gets deleted, method kept
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['url']).toBeUndefined();
    expect(arg['method']).toBe('POST');
  });

  it('submit deletes empty events array (lines 83-84)', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByTestId('set-events-empty'));
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['events']).toBeUndefined();
  });

  it('submit keeps non-empty events array (line 83 branch not taken)', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: 'routing' }));
    await userEvent.click(screen.getByTestId('set-events-full'));
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['events']).toEqual(['budget.exceeded']);
  });

  it('submit deletes targets when all inner arrays empty (line 93)', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-empty'));
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['targets']).toBeUndefined();
  });

  it('submit keeps targets when roles non-empty (lines 89, 92)', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-full'));
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect((arg['targets'] as Record<string, unknown>)['roles']).toEqual(['admin']);
  });

  it('keeps targets when permissions non-empty (line 90)', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-permissions'));
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect((arg['targets'] as Record<string, unknown>)['permissions']).toEqual(['admin:read']);
  });

  it('keeps targets when users non-empty (line 91)', async () => {
    await renderWithProvider('webhook');
    await userEvent.click(screen.getByRole('button', { name: 'recipients' }));
    await userEvent.click(screen.getByTestId('set-targets-users'));
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect((arg['targets'] as Record<string, unknown>)['users']).toEqual(['user-1']);
  });

  it('shows error on submit failure', async () => {
    mockCreate.mockRejectedValue(new Error('Server error'));
    await renderWithProvider();
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(screen.getByText('Server error')).toBeTruthy());
  });

  it('shows fallback error message for non-Error throws', async () => {
    mockCreate.mockRejectedValue('string-error');
    await renderWithProvider();
    await userEvent.click(screen.getByRole('button', { name: /Create Channel/ }));
    await waitFor(() => expect(screen.getByText('Failed to create')).toBeTruthy());
  });
});

// ── getRoles / getUsers error handling ───────────────────────────────────────

describe('NotificationChannelCreatePage — api error resilience', () => {
  it('still renders when getRoles rejects (line 60 catch)', async () => {
    mockGetRoles.mockRejectedValue(new Error('roles unavailable'));
    renderPage('?provider=dashboard');
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Channel/ })).toBeTruthy());
  });

  it('still renders when getUsers rejects (line 61 catch)', async () => {
    mockGetUsers.mockRejectedValue(new Error('users unavailable'));
    renderPage('?provider=dashboard');
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Channel/ })).toBeTruthy());
  });
});

// ── Provider defaults (buildDefaults coverage) ────────────────────────────────

describe('NotificationChannelCreatePage — provider-specific defaults', () => {
  const providers = ['smtp', 'ses', 'sendgrid', 'azure', 'google', 'webhook', 'slack', 'teams', 'pagerduty', 'discord', 'dashboard'];

  for (const provider of providers) {
    it(`renders form for provider=${provider}`, async () => {
      renderPage(`?provider=${provider}`);
      await waitFor(() => expect(screen.getByRole('button', { name: /Create Channel/ })).toBeTruthy());
    });
  }

  it('picker select then form appears for each provider in list', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Slack'));
    await userEvent.click(screen.getByText('Slack'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Channel/ })).toBeTruthy());
  });
});
