import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  isSecretField,
  isMasked,
  targetsHint,
  summariseChannel,
  providerLabel,
  ChannelDetailFields,
  ChannelEditFields,
  RoutingEditFields,
  RecipientsEditFields,
  EventsAndTargetsEditFields,
  EVENT_OPTIONS,
  PERM_OPTIONS,
  CHANNEL_PROVIDER_META,
} from './notificationChannelFields';
import type { ChannelProvider } from './notificationChannelFields';
import { getProjects } from '../api';

const mockGetProjects = vi.mocked(getProjects as (...args: unknown[]) => Promise<unknown>);

// Mock api and MultiSelect so we don't need a full auth context
vi.mock('../api', () => ({
  getProjects: vi.fn().mockResolvedValue([]),
  ALL_PERMISSIONS: [
    'project:read', 'project:write', 'model:read', 'model:write',
    'user:read', 'user:write', 'report:read', 'settings:read',
    'settings:write', 'notification:write', 'token:read', 'token:write',
    'role:write', 'audit:read',
  ],
}));

vi.mock('../components/MultiSelect', () => ({
  MultiSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
  }) => (
    <select
      multiple
      data-testid={`multiselect-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => {
        const selected = Array.from(e.target.selectedOptions).map(o => o.value);
        onChange(selected);
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

// ── Pure function coverage ────────────────────────────────────────────────────

describe('isSecretField', () => {
  it('returns true for a known secret field', () => {
    expect(isSecretField('smtp', 'password')).toBe(true);
  });

  it('returns false for a non-secret field', () => {
    expect(isSecretField('smtp', 'host')).toBe(false);
  });

  it('returns false for unknown provider (falls through ?? [])', () => {
    expect(isSecretField('dashboard', 'anything')).toBe(false);
  });
});

describe('isMasked', () => {
  it('returns true for the redact marker', () => {
    expect(isMasked('********')).toBe(true);
  });

  it('returns false for other values', () => {
    expect(isMasked('secret')).toBe(false);
    expect(isMasked(null)).toBe(false);
    expect(isMasked(undefined)).toBe(false);
  });
});

describe('targetsHint', () => {
  it('returns fixed-endpoint hint for webhook', () => {
    expect(targetsHint('webhook')).toContain('endpoint is fixed');
  });

  it('returns fixed-endpoint hint for slack', () => {
    expect(targetsHint('slack')).toContain('endpoint is fixed');
  });

  it('returns fixed-endpoint hint for teams', () => {
    expect(targetsHint('teams')).toContain('endpoint is fixed');
  });

  it('returns fixed-endpoint hint for pagerduty', () => {
    expect(targetsHint('pagerduty')).toContain('endpoint is fixed');
  });

  it('returns fixed-endpoint hint for discord', () => {
    expect(targetsHint('discord')).toContain('endpoint is fixed');
  });

  it('returns dashboard inbox hint for dashboard', () => {
    expect(targetsHint('dashboard')).toContain('inbox visibility');
  });

  it('returns email hint for email providers', () => {
    expect(targetsHint('smtp')).toContain('email');
    expect(targetsHint('ses')).toContain('email');
    expect(targetsHint('sendgrid')).toContain('email');
  });
});

describe('summariseChannel', () => {
  it('shows "All events" when events is undefined', () => {
    expect(summariseChannel({})).toContain('All events');
  });

  it('shows "All events" when events is empty', () => {
    expect(summariseChannel({ events: [] })).toContain('All events');
  });

  it('shows "1 event" for a single event', () => {
    expect(summariseChannel({ events: ['provider.error'] })).toContain('1 event');
  });

  it('shows "2 events" for two events', () => {
    expect(summariseChannel({ events: ['a', 'b'] })).toContain('2 events');
  });

  it('shows "Everyone" when no targets', () => {
    expect(summariseChannel({})).toContain('Everyone');
  });

  it('shows role count in targets', () => {
    expect(summariseChannel({ targets: { roles: ['admin'] } })).toContain('1 role');
  });

  it('shows plural roles', () => {
    expect(summariseChannel({ targets: { roles: ['admin', 'editor'] } })).toContain('2 roles');
  });

  it('shows permission count in targets', () => {
    expect(summariseChannel({ targets: { permissions: ['user:read'] } })).toContain('1 perm');
  });

  it('shows plural permissions', () => {
    expect(summariseChannel({ targets: { permissions: ['user:read', 'model:read'] } })).toContain('2 perms');
  });

  it('shows user count in targets', () => {
    expect(summariseChannel({ targets: { users: ['u1'] } })).toContain('1 user');
  });

  it('shows plural users', () => {
    expect(summariseChannel({ targets: { users: ['u1', 'u2'] } })).toContain('2 users');
  });

  it('combines roles + users', () => {
    const s = summariseChannel({ targets: { roles: ['admin'], users: ['u1', 'u2'] } });
    expect(s).toContain('1 role');
    expect(s).toContain('2 users');
  });
});

describe('providerLabel', () => {
  it('returns label for known provider', () => {
    expect(providerLabel('smtp')).toBe('SMTP');
    expect(providerLabel('dashboard')).toBe('Dashboard (in-app inbox)');
  });

  it('returns the key itself for unknown provider', () => {
    expect(providerLabel('unknown-provider')).toBe('unknown-provider');
  });
});

describe('EVENT_OPTIONS and PERM_OPTIONS', () => {
  it('EVENT_OPTIONS entries have value and label', () => {
    expect(EVENT_OPTIONS.length).toBeGreaterThan(0);
    for (const opt of EVENT_OPTIONS) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    }
  });

  it('PERM_OPTIONS entries have value and label', () => {
    expect(PERM_OPTIONS.length).toBeGreaterThan(0);
    for (const opt of PERM_OPTIONS) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    }
  });
});

describe('CHANNEL_PROVIDER_META', () => {
  it('contains all 11 providers', () => {
    expect(CHANNEL_PROVIDER_META.length).toBe(11);
  });
});

// ── ChannelDetailFields — all provider branches ───────────────────────────────

describe('ChannelDetailFields — dashboard', () => {
  it('shows no-credentials message', () => {
    render(<ChannelDetailFields channel={{ provider: 'dashboard' }} />);
    expect(screen.getByText(/No credentials required/)).toBeTruthy();
  });
});

describe('ChannelDetailFields — smtp', () => {
  it('renders smtp fields including TLS and Password status', () => {
    render(<ChannelDetailFields channel={{
      provider: 'smtp',
      fromAddress: 'no-reply@example.com',
      fromName: 'Routerly',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'user',
      password: '********',
    }} />);
    expect(screen.getByText('From Address')).toBeTruthy();
    expect(screen.getByText('From Name')).toBeTruthy();
    expect(screen.getByText('Host')).toBeTruthy();
    expect(screen.getByText('Port')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy(); // TLS/SSL=false → Disabled
    expect(screen.getByText('Username')).toBeTruthy();
    // password is set → "Configured"
    expect(screen.getByText('Configured')).toBeTruthy();
  });

  it('shows TLS Enabled when secure=true', () => {
    render(<ChannelDetailFields channel={{
      provider: 'smtp', fromAddress: 'a@b.com', host: 'h', port: 465, secure: true,
    }} />);
    expect(screen.getByText('Enabled')).toBeTruthy();
  });

  it('shows "Not set" for missing password', () => {
    render(<ChannelDetailFields channel={{
      provider: 'smtp', fromAddress: 'a@b.com', host: 'h', port: 587, secure: false,
    }} />);
    expect(screen.getByText('Not set')).toBeTruthy();
  });

  it('omits From Name when falsy', () => {
    render(<ChannelDetailFields channel={{
      provider: 'smtp', fromAddress: 'a@b.com', host: 'h', port: 587, secure: false,
    }} />);
    expect(screen.queryByText('From Name')).toBeNull();
  });
});

describe('ChannelDetailFields — ses', () => {
  it('renders ses fields', () => {
    render(<ChannelDetailFields channel={{
      provider: 'ses',
      fromAddress: 'a@b.com',
      fromName: 'Test',
      region: 'us-east-1',
      accessKeyId: 'AKID',
      secretAccessKey: '********',
    }} />);
    expect(screen.getByText('AWS Region')).toBeTruthy();
    expect(screen.getByText('Access Key ID')).toBeTruthy();
    expect(screen.getByText('Configured')).toBeTruthy();
  });

  it('omits Access Key ID when falsy', () => {
    render(<ChannelDetailFields channel={{
      provider: 'ses', fromAddress: 'a@b.com', region: 'us-east-1',
    }} />);
    expect(screen.queryByText('Access Key ID')).toBeNull();
  });
});

describe('ChannelDetailFields — sendgrid', () => {
  it('renders sendgrid fields', () => {
    render(<ChannelDetailFields channel={{
      provider: 'sendgrid', fromAddress: 'a@b.com', apiKey: '********',
    }} />);
    expect(screen.getByText('API Key')).toBeTruthy();
    expect(screen.getByText('Configured')).toBeTruthy();
  });
});

describe('ChannelDetailFields — azure', () => {
  it('renders azure fields', () => {
    render(<ChannelDetailFields channel={{
      provider: 'azure', fromAddress: 'a@b.com', connectionString: '',
    }} />);
    expect(screen.getByText('Connection String')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
  });
});

describe('ChannelDetailFields — google', () => {
  it('renders google fields', () => {
    render(<ChannelDetailFields channel={{
      provider: 'google',
      fromAddress: 'a@b.com',
      clientId: 'client-id',
      clientSecret: '********',
      refreshToken: '********',
    }} />);
    expect(screen.getByText('Client ID')).toBeTruthy();
    expect(screen.getAllByText('Configured')).toHaveLength(2);
  });
});

describe('ChannelDetailFields — webhook', () => {
  it('renders webhook fields with default method', () => {
    render(<ChannelDetailFields channel={{
      provider: 'webhook', url: 'https://example.com/hook',
    }} />);
    expect(screen.getByText('URL')).toBeTruthy();
    expect(screen.getByText('POST')).toBeTruthy(); // method fallback
  });

  it('shows explicit method when set', () => {
    render(<ChannelDetailFields channel={{
      provider: 'webhook', url: 'https://example.com/hook', method: 'GET',
    }} />);
    expect(screen.getByText('GET')).toBeTruthy();
  });
});

describe('ChannelDetailFields — slack', () => {
  it('renders slack fields', () => {
    render(<ChannelDetailFields channel={{
      provider: 'slack', botToken: '********', channelId: 'C123',
    }} />);
    expect(screen.getByText('Bot Token')).toBeTruthy();
    expect(screen.getByText('Channel ID')).toBeTruthy();
  });
});

describe('ChannelDetailFields — teams', () => {
  it('renders teams webhook url field', () => {
    render(<ChannelDetailFields channel={{ provider: 'teams', webhookUrl: '********' }} />);
    expect(screen.getByText('Webhook URL')).toBeTruthy();
  });
});

describe('ChannelDetailFields — pagerduty', () => {
  it('renders pagerduty integration key field', () => {
    render(<ChannelDetailFields channel={{ provider: 'pagerduty', integrationKey: '********' }} />);
    expect(screen.getByText('Integration Key')).toBeTruthy();
  });
});

describe('ChannelDetailFields — discord', () => {
  it('renders discord webhook url field', () => {
    render(<ChannelDetailFields channel={{ provider: 'discord', webhookUrl: '********' }} />);
    expect(screen.getByText('Webhook URL')).toBeTruthy();
  });
});

describe('ChannelDetailFields — default (unknown provider)', () => {
  it('returns null for unknown provider', () => {
    const { container } = render(<ChannelDetailFields channel={{ provider: 'unknown' as ChannelProvider }} />);
    expect(container.textContent).toBe('');
  });
});

// ── ChannelEditFields — all provider branches (lines 454-501, 516-539) ────────

function renderEditFields(provider: ChannelProvider, extraForm: Record<string, unknown> = {}, isEdit = false) {
  const onChange = vi.fn();
  const form: Record<string, unknown> = { provider, ...extraForm };
  render(<ChannelEditFields form={form} onChange={onChange} isEdit={isEdit} />);
  return onChange;
}

describe('ChannelEditFields — dashboard', () => {
  it('shows no-credentials message', () => {
    renderEditFields('dashboard');
    expect(screen.getByText(/No credentials required/)).toBeTruthy();
  });
});

describe('ChannelEditFields — smtp (lines 448-472)', () => {
  it('renders all smtp fields', () => {
    renderEditFields('smtp', { fromAddress: 'a@b.com', port: 587, secure: false });
    expect(screen.getByPlaceholderText('smtp.example.com')).toBeTruthy();
    expect(screen.getByText('Use TLS / SSL')).toBeTruthy();
    expect(screen.getByText(/STARTTLS/)).toBeTruthy();
  });

  it('shows direct SSL label when secure=true', () => {
    renderEditFields('smtp', { fromAddress: 'a@b.com', port: 465, secure: true });
    expect(screen.getByText(/direct SSL/)).toBeTruthy();
  });

  it('onChange fires on TLS checkbox toggle', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields form={{ provider: 'smtp', fromAddress: 'a@b.com', secure: false }} onChange={onChange} isEdit={false} />);
    const tlsCheckbox = document.getElementById('smtp-tls') as HTMLInputElement;
    await userEvent.click(tlsCheckbox);
    expect(onChange).toHaveBeenCalledWith('secure', true);
  });

  it('onChange fires on host input change', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields form={{ provider: 'smtp', fromAddress: 'a@b.com', secure: false }} onChange={onChange} isEdit={false} />);
    const hostInput = screen.getByPlaceholderText('smtp.example.com');
    await userEvent.type(hostInput, 'm');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows "Leave blank to keep current" placeholder for password in edit mode', () => {
    renderEditFields('smtp', { fromAddress: 'a@b.com', secure: false }, true);
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwInput?.placeholder).toBe('Leave blank to keep current');
  });
});

describe('ChannelEditFields — ses (lines 474-484)', () => {
  it('renders ses fields', () => {
    renderEditFields('ses', { fromAddress: 'a@b.com' });
    expect(screen.getByPlaceholderText('us-east-1')).toBeTruthy();
    expect(screen.getByText(/IAM instance role/)).toBeTruthy();
  });
});

describe('ChannelEditFields — sendgrid (lines 486-491)', () => {
  it('renders sendgrid API key field', () => {
    renderEditFields('sendgrid', { fromAddress: 'a@b.com' });
    expect(screen.getByText('API Key')).toBeTruthy();
  });
});

describe('ChannelEditFields — azure (lines 493-498)', () => {
  it('renders azure connection string field', () => {
    renderEditFields('azure', { fromAddress: 'a@b.com' });
    expect(screen.getByText('Connection String')).toBeTruthy();
  });
});

describe('ChannelEditFields — google (lines 500-508)', () => {
  it('renders google fields', () => {
    renderEditFields('google', { fromAddress: 'a@b.com' });
    expect(screen.getByText('Client ID')).toBeTruthy();
    expect(screen.getByText('Client Secret')).toBeTruthy();
    expect(screen.getByText('Refresh Token')).toBeTruthy();
  });
});

describe('ChannelEditFields — webhook (lines 509-523)', () => {
  it('renders webhook URL and method select', () => {
    renderEditFields('webhook');
    expect(screen.getByPlaceholderText('https://example.com/webhook')).toBeTruthy();
    expect(screen.getByText('Method')).toBeTruthy();
    const methodSelect = screen.getByDisplayValue('POST');
    expect(methodSelect).toBeTruthy();
  });

  it('onChange fires when method select changes', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields form={{ provider: 'webhook' }} onChange={onChange} isEdit={false} />);
    const methodSelect = screen.getByDisplayValue('POST');
    await userEvent.selectOptions(methodSelect, 'GET');
    expect(onChange).toHaveBeenCalledWith('method', 'GET');
  });
});

describe('ChannelEditFields — slack (lines 525-530)', () => {
  it('renders slack bot token and channel id fields', () => {
    renderEditFields('slack');
    expect(screen.getByText('Bot Token')).toBeTruthy();
    expect(screen.getByPlaceholderText('C1234567890')).toBeTruthy();
  });
});

describe('ChannelEditFields — teams (lines 532)', () => {
  it('renders teams webhook URL field', () => {
    renderEditFields('teams');
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwInput).toBeTruthy();
    expect(pwInput.placeholder).toContain('outlook.office.com');
  });
});

describe('ChannelEditFields — pagerduty (line 534)', () => {
  it('renders pagerduty integration key field', () => {
    renderEditFields('pagerduty');
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwInput).toBeTruthy();
    expect(pwInput.placeholder).toContain('32-character');
  });
});

describe('ChannelEditFields — discord (line 536)', () => {
  it('renders discord webhook URL field', () => {
    renderEditFields('discord');
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pwInput).toBeTruthy();
    expect(pwInput.placeholder).toContain('discord.com');
  });
});

describe('ChannelEditFields — default (unknown provider)', () => {
  it('renders null for unknown provider', () => {
    const { container } = render(
      <ChannelEditFields form={{ provider: 'unknown' as ChannelProvider }} onChange={vi.fn()} isEdit={false} />
    );
    expect(container.textContent).toBe('');
  });
});

// ── EmailBaseFields branches — webhook/dashboard skip from-address ─────────────

describe('ChannelEditFields — EmailBaseFields skips for webhook/dashboard', () => {
  it('webhook does not render From Address', () => {
    renderEditFields('webhook');
    expect(screen.queryByLabelText(/From Address/)).toBeNull();
  });

  it('dashboard does not render From Address', () => {
    renderEditFields('dashboard');
    expect(screen.queryByLabelText(/From Address/)).toBeNull();
  });
});

// ── EditInput onChange branches ────────────────────────────────────────────────

describe('ChannelEditFields — EditInput optional field clears to undefined', () => {
  it('clearing an optional field (fromName) calls onChange with undefined', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields
      form={{ provider: 'smtp', fromAddress: 'a@b.com', fromName: 'Routerly', secure: false }}
      onChange={onChange}
      isEdit={false}
    />);
    const fromNameInput = screen.getByPlaceholderText('Routerly');
    await userEvent.clear(fromNameInput);
    // clearing optional field → onChange called with undefined
    expect(onChange).toHaveBeenCalledWith('fromName', undefined);
  });
});

// ── RoutingEditFields ─────────────────────────────────────────────────────────

describe('RoutingEditFields', () => {
  beforeEach(() => {
    mockGetProjects.mockResolvedValue([
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' },
    ]);
  });

  it('renders events, projects, and cooldown sections', async () => {
    render(<RoutingEditFields form={{ events: [], cooldownSeconds: 0 }} onChange={vi.fn()} />);
    expect(screen.getByText('Events')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Cooldown')).toBeTruthy();
  });

  it('onChange fires when events MultiSelect changes', async () => {
    const onChange = vi.fn();
    render(<RoutingEditFields form={{ events: [] }} onChange={onChange} />);
    const evSelect = screen.getByTestId('multiselect-All events (leave empty for all)') as HTMLSelectElement;
    await userEvent.selectOptions(evSelect, ['provider.error']);
    expect(onChange).toHaveBeenCalledWith('events', ['provider.error']);
  });

  it('onChange passes undefined when events cleared', async () => {
    const onChange = vi.fn();
    render(<RoutingEditFields form={{ events: ['provider.error'] }} onChange={onChange} />);
    const evSelect = screen.getByTestId('multiselect-All events (leave empty for all)') as HTMLSelectElement;
    // Deselect all by selecting nothing
    await userEvent.deselectOptions(evSelect, ['provider.error']);
    expect(onChange).toHaveBeenCalledWith('events', undefined);
  });

  it('cooldown onChange fires and sets undefined when <= 0', async () => {
    const onChange = vi.fn();
    render(<RoutingEditFields form={{ cooldownSeconds: 60 }} onChange={onChange} />);
    const numInput = screen.getByPlaceholderText('0');
    await userEvent.clear(numInput);
    await userEvent.type(numInput, '0');
    expect(onChange).toHaveBeenCalledWith('cooldownSeconds', undefined);
  });

  it('cooldown onChange sets value when > 0', async () => {
    const onChange = vi.fn();
    render(<RoutingEditFields form={{ cooldownSeconds: 0 }} onChange={onChange} />);
    const numInput = screen.getByPlaceholderText('0');
    await userEvent.clear(numInput);
    await userEvent.type(numInput, '3');
    expect(onChange).toHaveBeenCalledWith('cooldownSeconds', 3);
  });

  it('shows loaded projects in multiselect', async () => {
    render(<RoutingEditFields form={{ events: [], projects: [] }} onChange={vi.fn()} />);
    await waitFor(() => {
      const projSelect = screen.getByTestId('multiselect-All projects (leave empty for all)') as HTMLSelectElement;
      expect(projSelect.options.length).toBeGreaterThan(0);
    });
  });
});

// ── RecipientsEditFields ──────────────────────────────────────────────────────

describe('RecipientsEditFields', () => {
  const roles = [{ id: 'r1', name: 'Admin' }, { id: 'r2', name: 'Editor' }] as unknown as import('../api').Role[];
  const users = [{ id: 'u1', email: 'alice@example.com' }] as unknown as import('../api').User[];

  it('renders roles, permissions, and users sections', () => {
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: {} }}
      onChange={vi.fn()}
      roles={roles}
      users={users}
    />);
    expect(screen.getByText('Recipients / Targets')).toBeTruthy();
    expect(screen.getByText('Roles')).toBeTruthy();
    expect(screen.getByText('Permissions')).toBeTruthy();
    expect(screen.getByText('Individual users')).toBeTruthy();
  });

  it('shows email hint for smtp provider', () => {
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: {} }}
      onChange={vi.fn()}
      roles={[]}
      users={[]}
    />);
    expect(screen.getByText(/email/)).toBeTruthy();
  });

  it('shows dashboard hint for dashboard provider', () => {
    render(<RecipientsEditFields
      form={{ provider: 'dashboard', targets: {} }}
      onChange={vi.fn()}
      roles={[]}
      users={[]}
    />);
    expect(screen.getByText(/inbox visibility/)).toBeTruthy();
  });

  it('shows fixed-endpoint hint for webhook provider', () => {
    render(<RecipientsEditFields
      form={{ provider: 'webhook', targets: {} }}
      onChange={vi.fn()}
      roles={[]}
      users={[]}
    />);
    expect(screen.getByText(/endpoint is fixed/)).toBeTruthy();
  });

  it('onChange fires when roles MultiSelect changes', async () => {
    const onChange = vi.fn();
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: {} }}
      onChange={onChange}
      roles={roles}
      users={[]}
    />);
    const roleSelect = screen.getByTestId('multiselect-All roles (everyone)') as HTMLSelectElement;
    await userEvent.selectOptions(roleSelect, ['r1']);
    expect(onChange).toHaveBeenCalledWith('targets', expect.objectContaining({ roles: ['r1'] }));
  });

  it('onChange passes undefined for roles when cleared', async () => {
    const onChange = vi.fn();
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: { roles: ['r1'] } }}
      onChange={onChange}
      roles={roles}
      users={[]}
    />);
    const roleSelect = screen.getByTestId('multiselect-All roles (everyone)') as HTMLSelectElement;
    await userEvent.deselectOptions(roleSelect, ['r1']);
    expect(onChange).toHaveBeenCalledWith('targets', expect.objectContaining({ roles: undefined }));
  });

  it('onChange fires when users MultiSelect changes', async () => {
    const onChange = vi.fn();
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: {} }}
      onChange={onChange}
      roles={[]}
      users={users}
    />);
    const userSelect = screen.getByTestId('multiselect-All users (everyone)') as HTMLSelectElement;
    await userEvent.selectOptions(userSelect, ['u1']);
    expect(onChange).toHaveBeenCalledWith('targets', expect.objectContaining({ users: ['u1'] }));
  });
});

// ── EventsAndTargetsEditFields (backward-compat wrapper) ─────────────────────

describe('EventsAndTargetsEditFields', () => {
  it('renders both Routing and Recipients sections', () => {
    render(<EventsAndTargetsEditFields
      form={{ provider: 'smtp', targets: {} }}
      onChange={vi.fn()}
      roles={[]}
      users={[]}
    />);
    expect(screen.getByText('Events')).toBeTruthy();
    expect(screen.getByText('Recipients / Targets')).toBeTruthy();
  });
});

// ── SecretEditInput onChange (line 280) ───────────────────────────────────────

describe('ChannelEditFields — SecretEditInput onChange fires', () => {
  it('typing in smtp password secret field triggers onChange', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields
      form={{ provider: 'smtp', fromAddress: 'a@b.com', secure: false }}
      onChange={onChange}
      isEdit={false}
    />);
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await userEvent.type(pwInput, 'secret');
    expect(onChange).toHaveBeenCalledWith('password', expect.any(String));
  });
});

// ── EmailBaseFields fromAddress onChange (line 297) ──────────────────────────

describe('ChannelEditFields — EmailBaseFields fromAddress onChange fires', () => {
  it('typing in fromAddress triggers onChange', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields
      form={{ provider: 'smtp', fromAddress: '', secure: false }}
      onChange={onChange}
      isEdit={false}
    />);
    const fromInput = screen.getByPlaceholderText('noreply@example.com') as HTMLInputElement;
    await userEvent.type(fromInput, 'test@example.com');
    expect(onChange).toHaveBeenCalledWith('fromAddress', expect.any(String));
  });
});

// ── RoutingEditFields projects onChange (line 347) ───────────────────────────

describe('RoutingEditFields — projects MultiSelect onChange fires', () => {
  beforeEach(() => {
    mockGetProjects.mockResolvedValue([
      { id: 'p1', name: 'Project 1' },
    ]);
  });

  it('selecting a project fires onChange with project id', async () => {
    const onChange = vi.fn();
    render(<RoutingEditFields form={{ events: [], projects: [] }} onChange={onChange} />);
    await waitFor(() => {
      const projSelect = screen.getByTestId('multiselect-All projects (leave empty for all)') as HTMLSelectElement;
      expect(projSelect.options.length).toBeGreaterThan(0);
    });
    const projSelect = screen.getByTestId('multiselect-All projects (leave empty for all)') as HTMLSelectElement;
    await userEvent.selectOptions(projSelect, ['p1']);
    expect(onChange).toHaveBeenCalledWith('projects', ['p1']);
  });

  it('deselecting all projects fires onChange with undefined', async () => {
    const onChange = vi.fn();
    render(<RoutingEditFields form={{ events: [], projects: ['p1'] }} onChange={onChange} />);
    await waitFor(() => {
      const projSelect = screen.getByTestId('multiselect-All projects (leave empty for all)') as HTMLSelectElement;
      expect(projSelect.options.length).toBeGreaterThan(0);
    });
    const projSelect = screen.getByTestId('multiselect-All projects (leave empty for all)') as HTMLSelectElement;
    await userEvent.deselectOptions(projSelect, ['p1']);
    expect(onChange).toHaveBeenCalledWith('projects', undefined);
  });
});

// ── RecipientsEditFields permissions onChange (line 406) ─────────────────────

describe('RecipientsEditFields — permissions MultiSelect onChange fires', () => {
  it('selecting a permission fires onChange', async () => {
    const onChange = vi.fn();
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: {} }}
      onChange={onChange}
      roles={[]}
      users={[]}
    />);
    const permSelect = screen.getByTestId('multiselect-All permissions (everyone)') as HTMLSelectElement;
    await userEvent.selectOptions(permSelect, ['project:read']);
    expect(onChange).toHaveBeenCalledWith('targets', expect.objectContaining({ permissions: ['project:read'] }));
  });

  it('clearing permissions fires onChange with undefined', async () => {
    const onChange = vi.fn();
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: { permissions: ['project:read'] } }}
      onChange={onChange}
      roles={[]}
      users={[]}
    />);
    const permSelect = screen.getByTestId('multiselect-All permissions (everyone)') as HTMLSelectElement;
    await userEvent.deselectOptions(permSelect, ['project:read']);
    expect(onChange).toHaveBeenCalledWith('targets', expect.objectContaining({ permissions: undefined }));
  });
});

// ── ChannelEditFields smtp port onChange (line 454) ──────────────────────────

describe('ChannelEditFields — smtp port field onChange fires', () => {
  it('changing port triggers onChange with Number value', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields
      form={{ provider: 'smtp', fromAddress: 'a@b.com', secure: false, port: 587 }}
      onChange={onChange}
      isEdit={false}
    />);
    // Port input: type="number", value derived from form.port
    const portInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    await userEvent.clear(portInput);
    await userEvent.type(portInput, '465');
    expect(onChange).toHaveBeenCalledWith('port', expect.any(Number));
  });
});

// ── ChannelDetailFields — fromName present for sendgrid/azure/google ──────────

describe('ChannelDetailFields — fromName variations', () => {
  it('shows From Name for sendgrid when present', () => {
    render(<ChannelDetailFields channel={{
      provider: 'sendgrid', fromAddress: 'a@b.com', fromName: 'Routerly', apiKey: '********',
    }} />);
    expect(screen.getByText('From Name')).toBeTruthy();
  });

  it('omits From Name for sendgrid when absent', () => {
    render(<ChannelDetailFields channel={{
      provider: 'sendgrid', fromAddress: 'a@b.com', apiKey: '********',
    }} />);
    expect(screen.queryByText('From Name')).toBeNull();
  });

  it('shows From Name for azure when present', () => {
    render(<ChannelDetailFields channel={{
      provider: 'azure', fromAddress: 'a@b.com', fromName: 'Routerly', connectionString: '********',
    }} />);
    expect(screen.getByText('From Name')).toBeTruthy();
  });

  it('omits From Name for azure when absent', () => {
    render(<ChannelDetailFields channel={{
      provider: 'azure', fromAddress: 'a@b.com', connectionString: '',
    }} />);
    expect(screen.queryByText('From Name')).toBeNull();
  });

  it('shows From Name for google when present', () => {
    render(<ChannelDetailFields channel={{
      provider: 'google', fromAddress: 'a@b.com', fromName: 'Routerly',
      clientId: 'cid', clientSecret: '********', refreshToken: '********',
    }} />);
    expect(screen.getByText('From Name')).toBeTruthy();
  });

  it('omits From Name for google when absent', () => {
    render(<ChannelDetailFields channel={{
      provider: 'google', fromAddress: 'a@b.com',
      clientId: 'cid', clientSecret: '********', refreshToken: '********',
    }} />);
    expect(screen.queryByText('From Name')).toBeNull();
  });
});

// ── ChannelDetailFields — smtp without port (port ?? '' branch) ───────────────

describe('ChannelDetailFields — smtp port absent', () => {
  it('renders port field as empty string when port is undefined', () => {
    render(<ChannelDetailFields channel={{
      provider: 'smtp', fromAddress: 'a@b.com', host: 'h', secure: false,
    }} />);
    // Port label must exist; value may be empty
    expect(screen.getByText('Port')).toBeTruthy();
  });
});

// ── RecipientsEditFields — targets undefined (targets ?? {} branch) ───────────

describe('RecipientsEditFields — targets undefined', () => {
  it('renders without crashing when targets is not set in form', () => {
    render(<RecipientsEditFields
      form={{ provider: 'smtp' }}
      onChange={vi.fn()}
      roles={[]}
      users={[{ id: 'u1', email: 'a@b.com' }] as unknown as import('../api').User[]}
    />);
    expect(screen.getByText('Recipients / Targets')).toBeTruthy();
  });

  it('renders without crashing when targets has no users key', () => {
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: { roles: ['r1'] } }}
      onChange={vi.fn()}
      roles={[{ id: 'r1', name: 'Admin' }] as unknown as import('../api').Role[]}
      users={[{ id: 'u1', email: 'a@b.com' }] as unknown as import('../api').User[]}
    />);
    expect(screen.getByText('Individual users')).toBeTruthy();
  });
});

// ── EditInput optional-clear branch (L261 required=false → undefined) ─────────

describe('ChannelEditFields — EditInput clears optional field to undefined', () => {
  it('clearing the optional username field calls onChange with undefined', async () => {
    const onChange = vi.fn();
    render(<ChannelEditFields
      form={{ provider: 'smtp', fromAddress: 'a@b.com', secure: false, username: 'admin' }}
      onChange={onChange}
      isEdit={false}
    />);
    // Username is optional EditInput — clearing it to empty string triggers required=false path
    const usernameInput = screen.getByDisplayValue('admin') as HTMLInputElement;
    await userEvent.clear(usernameInput);
    expect(onChange).toHaveBeenCalledWith('username', undefined);
  });
});

// ── RecipientsEditFields — deselect all users → undefined ────────────────────

describe('RecipientsEditFields — deselect all users fires onChange with undefined', () => {
  it('clearing all users calls onChange with users: undefined', async () => {
    const onChange = vi.fn();
    render(<RecipientsEditFields
      form={{ provider: 'smtp', targets: { users: ['u1'] } }}
      onChange={onChange}
      roles={[]}
      users={[{ id: 'u1', email: 'alice@example.com' }] as unknown as import('../api').User[]}
    />);
    const userSelect = screen.getByTestId('multiselect-All users (everyone)') as HTMLSelectElement;
    await userEvent.deselectOptions(userSelect, ['u1']);
    expect(onChange).toHaveBeenCalledWith('targets', expect.objectContaining({ users: undefined }));
  });
});
