/**
 * Shared field rendering for notification channel forms.
 * Used by Create, Edit, and Detail pages so the field list is defined once.
 */
import React, { useEffect, useState } from 'react';
import { Bell, Users, FolderOpen } from 'lucide-react';
import { CHANNEL_SECRET_FIELDS } from '@routerly/shared';
import { MultiSelect } from '../components/MultiSelect';
import { ALL_PERMISSIONS, getProjects } from '../api';
import type { Permission, Project } from '../api';
import type { Role, User } from '../api';

export type ChannelProvider =
  | 'smtp' | 'ses' | 'sendgrid' | 'azure' | 'google'
  | 'webhook' | 'slack' | 'teams' | 'pagerduty' | 'discord' | 'dashboard';

export const CHANNEL_PROVIDER_META: Array<{ key: ChannelProvider; label: string; description: string }> = [
  { key: 'dashboard',  label: 'Dashboard (in-app inbox)', description: 'Routes events to the in-app inbox' },
  { key: 'smtp',       label: 'SMTP',                     description: 'Custom mail server' },
  { key: 'ses',        label: 'Amazon SES',               description: 'AWS Simple Email Service' },
  { key: 'sendgrid',   label: 'SendGrid',                 description: 'Twilio SendGrid' },
  { key: 'azure',      label: 'Azure Communication',      description: 'Azure Communication Services' },
  { key: 'google',     label: 'Google / Gmail',           description: 'Gmail via OAuth2' },
  { key: 'webhook',    label: 'Webhook',                  description: 'HTTP webhook callback' },
  { key: 'slack',      label: 'Slack',                    description: 'Slack Bot API' },
  { key: 'teams',      label: 'Microsoft Teams',          description: 'Teams Incoming Webhook' },
  { key: 'pagerduty',  label: 'PagerDuty',                description: 'PagerDuty Events API v2' },
  { key: 'discord',    label: 'Discord',                  description: 'Discord Webhook' },
];

const REDACT_MARKER = '********';

export function isSecretField(provider: ChannelProvider, field: string): boolean {
  /* v8 ignore next */
  return (CHANNEL_SECRET_FIELDS[provider] ?? []).includes(field);
}

/** Returns true when the stored value is a masked marker (read from service). */
export function isMasked(value: unknown): boolean {
  return value === REDACT_MARKER;
}

// ── Readable labels for the canonical events ──────────────────────────────────
const EVENT_LABELS: Record<string, string> = {
  'provider.error':            'Provider – Error',
  'provider.degraded':         'Provider – Degraded',
  'provider.recovered':        'Provider – Recovered',
  'provider.rate_limited':     'Provider – Rate Limited',
  'routing.no_candidates':     'Routing – No Candidates',
  'routing.fallback_used':     'Routing – Fallback Used',
  'auth.login_failed':         'Auth – Login Failed',
  'auth.token_invalid':        'Auth – Token Invalid',
  'config.model_added':        'Config – Model Added',
  'config.model_deleted':      'Config – Model Deleted',
  'config.project_created':    'Config – Project Created',
  'config.project_deleted':    'Config – Project Deleted',
  'budget.threshold_reached':  'Budget – Threshold Reached',
  'budget.exceeded':           'Budget – Exceeded',
  'budget.reset':              'Budget – Reset',
  'system.startup':            'System – Startup',
  'system.shutdown':           'System – Shutdown',
};

import { NOTIFICATION_EVENTS } from '@routerly/shared';
/* v8 ignore next */
export const EVENT_OPTIONS = NOTIFICATION_EVENTS.map(e => ({ value: e, label: EVENT_LABELS[e] ?? e }));

const PERM_LABELS_LOCAL: Record<Permission, string> = {
  'project:read':       'Projects – Read',
  'project:write':      'Projects – Write',
  'model:read':         'Models – Read',
  'model:write':        'Models – Write',
  'user:read':          'Users – Read',
  'user:write':         'Users – Write',
  'report:read':        'Reports – Read',
  'settings:read':      'Settings – Read',
  'settings:write':     'Settings – Write',
  'notification:write': 'Notifications – Write',
  'token:read':         'Tokens – Read',
  'token:write':        'Tokens – Write',
  'role:write':         'Roles – Write',
  'audit:read':         'Audit Log – Read',
};
/* v8 ignore next */
export const PERM_OPTIONS = ALL_PERMISSIONS.map(p => ({ value: p, label: PERM_LABELS_LOCAL[p] ?? p }));

const FIXED_ENDPOINT_PROVIDERS: ChannelProvider[] = ['webhook', 'slack', 'teams', 'pagerduty', 'discord'];

export function targetsHint(provider: ChannelProvider): string | null {
  if (FIXED_ENDPOINT_PROVIDERS.includes(provider)) {
    return 'For this channel type, targets do not change delivery (the endpoint is fixed). They filter which events are logged in the audit trail per recipient.';
  }
  if (provider === 'dashboard') {
    return 'Targets control inbox visibility — only the matched users will see these notifications in their in-app inbox.';
  }
  return 'Targets determine which users receive this email. Leave all empty to send to all users.';
}

/** Summarise events + targets for list view. */
export function summariseChannel(ch: Record<string, unknown>): string {
  const parts: string[] = [];
  const events = ch['events'] as string[] | undefined;
  const evCount = events?.length ?? 0;
  parts.push(evCount === 0 ? 'All events' : `${evCount} event${evCount > 1 ? 's' : ''}`);
  const t = ch['targets'] as { roles?: string[]; permissions?: string[]; users?: string[] } | undefined;
  const targetParts: string[] = [];
  if (t?.roles?.length) targetParts.push(`${t.roles.length} role${t.roles.length > 1 ? 's' : ''}`);
  if (t?.permissions?.length) targetParts.push(`${t.permissions.length} perm${t.permissions.length > 1 ? 's' : ''}`);
  if (t?.users?.length) targetParts.push(`${t.users.length} user${t.users.length > 1 ? 's' : ''}`);
  parts.push(targetParts.length ? targetParts.join(', ') : 'Everyone');
  return parts.join(' · ');
}

// ── Field value getters ────────────────────────────────────────────────────────

function str(ch: Record<string, unknown>, key: string): string {
  const v = ch[key];
  return typeof v === 'string' ? v : '';
}

// ── Read-only detail field rendering ──────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8,
  display: 'flex', alignItems: 'center', gap: 5,
};

function DetailField({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontFamily: typeof value === 'string' ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function SecretDetailField({ label, value }: { label: string; value: unknown }) {
  const display = (value && typeof value === 'string' && value.length > 0)
    ? 'Configured'
    : 'Not set';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: '0.875rem',
        color: display === 'Configured' ? 'var(--text-secondary)' : 'var(--text-muted)',
        fontStyle: display === 'Not set' ? 'italic' : undefined,
      }}>{display}</div>
    </div>
  );
}

/** Read-only view of provider-specific fields. Secrets shown as "Configured" / "Not set". */
export function ChannelDetailFields({ channel }: { channel: Record<string, unknown> }) {
  const provider = channel['provider'] as ChannelProvider;
  switch (provider) {
    case 'dashboard':
      return (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Routes matching events to the in-app notification inbox. No credentials required.
        </p>
      );
    case 'smtp':
      return (
        <>
          <DetailField label="From Address" value={str(channel, 'fromAddress')} />
          {channel['fromName'] && <DetailField label="From Name" value={str(channel, 'fromName')} />}
          <DetailField label="Host" value={str(channel, 'host')} />
          <DetailField label="Port" value={String(channel['port'] ?? '')} />
          <DetailField label="TLS/SSL" value={channel['secure'] ? 'Enabled' : 'Disabled'} />
          {channel['username'] && <DetailField label="Username" value={str(channel, 'username')} />}
          <SecretDetailField label="Password" value={channel['password']} />
        </>
      );
    case 'ses':
      return (
        <>
          <DetailField label="From Address" value={str(channel, 'fromAddress')} />
          {channel['fromName'] && <DetailField label="From Name" value={str(channel, 'fromName')} />}
          <DetailField label="AWS Region" value={str(channel, 'region')} />
          {channel['accessKeyId'] && <DetailField label="Access Key ID" value={str(channel, 'accessKeyId')} />}
          <SecretDetailField label="Secret Access Key" value={channel['secretAccessKey']} />
        </>
      );
    case 'sendgrid':
      return (
        <>
          <DetailField label="From Address" value={str(channel, 'fromAddress')} />
          {channel['fromName'] && <DetailField label="From Name" value={str(channel, 'fromName')} />}
          <SecretDetailField label="API Key" value={channel['apiKey']} />
        </>
      );
    case 'azure':
      return (
        <>
          <DetailField label="From Address" value={str(channel, 'fromAddress')} />
          {channel['fromName'] && <DetailField label="From Name" value={str(channel, 'fromName')} />}
          <SecretDetailField label="Connection String" value={channel['connectionString']} />
        </>
      );
    case 'google':
      return (
        <>
          <DetailField label="From Address" value={str(channel, 'fromAddress')} />
          {channel['fromName'] && <DetailField label="From Name" value={str(channel, 'fromName')} />}
          <DetailField label="Client ID" value={str(channel, 'clientId')} />
          <SecretDetailField label="Client Secret" value={channel['clientSecret']} />
          <SecretDetailField label="Refresh Token" value={channel['refreshToken']} />
        </>
      );
    case 'webhook':
      return (
        <>
          <DetailField label="URL" value={str(channel, 'url')} />
          <DetailField label="Method" value={str(channel, 'method') || 'POST'} />
          <SecretDetailField label="Signing Secret" value={channel['secret']} />
        </>
      );
    case 'slack':
      return (
        <>
          <SecretDetailField label="Bot Token" value={channel['botToken']} />
          <DetailField label="Channel ID" value={str(channel, 'channelId')} />
        </>
      );
    case 'teams':
      return <SecretDetailField label="Webhook URL" value={channel['webhookUrl']} />;
    case 'pagerduty':
      return <SecretDetailField label="Integration Key" value={channel['integrationKey']} />;
    case 'discord':
      return <SecretDetailField label="Webhook URL" value={channel['webhookUrl']} />;
    default:
      return null;
  }
}

// ── Edit form field rendering ─────────────────────────────────────────────────

interface EditFieldsProps {
  /** Current mutable form state — keyed by field name. */
  form: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  /** When true, secret fields start empty with "Leave blank to keep current" placeholder. */
  isEdit: boolean;
}

function EditInput({
  label, fieldKey, form, onChange, type = 'text', placeholder, required,
}: {
  label: string; fieldKey: string; form: Record<string, unknown>; onChange: (k: string, v: unknown) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}{!required && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (optional)</span>}</label>
      <input
        className="form-input"
        type={type}
        value={/* v8 ignore next */ typeof form[fieldKey] === 'string' ? (form[fieldKey] as string) : ''}
        onChange={e => onChange(fieldKey, e.target.value || (required ? e.target.value : undefined))}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

function SecretEditInput({
  label, fieldKey, form, onChange, isEdit, placeholder: customPlaceholder,
}: {
  label: string; fieldKey: string; form: Record<string, unknown>; onChange: (k: string, v: unknown) => void;
  isEdit: boolean; placeholder?: string;
}) {
  const placeholder = isEdit ? 'Leave blank to keep current' : (customPlaceholder ?? '');
  /* v8 ignore next */
  const secretValue = typeof form[fieldKey] === 'string' ? (form[fieldKey] as string) : '';
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type="password"
        value={secretValue}
        onChange={e => onChange(fieldKey, e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
      />
    </div>
  );
}

function EmailBaseFields({ form, onChange, isEdit }: EditFieldsProps) {
  const provider = form['provider'] as ChannelProvider;
  /* v8 ignore next */
  if (provider === 'webhook' || provider === 'dashboard') return null;
  /* v8 ignore next */
  const fromAddress = typeof form['fromAddress'] === 'string' ? form['fromAddress'] : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">From Address</label>
        <input className="form-input" type="email"
          value={fromAddress}
          onChange={e => onChange('fromAddress', e.target.value)} placeholder="noreply@example.com" required />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">From Name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
        <input className="form-input"
          value={typeof form['fromName'] === 'string' ? form['fromName'] : ''}
          onChange={e => onChange('fromName', e.target.value || undefined)} placeholder="Routerly" />
      </div>
    </div>
  );
}

type TargetsProps = {
  form: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  roles: Role[];
  users: User[];
};

/** Events + Projects + Cooldown section (Routing tab). */
export function RoutingEditFields({
  form, onChange,
}: Pick<TargetsProps, 'form' | 'onChange'>) {
  const events = (form['events'] as string[] | undefined) ?? [];
  const cooldownSeconds = typeof form['cooldownSeconds'] === 'number' ? form['cooldownSeconds'] : 0;
  const selectedProjects = (form['projects'] as string[] | undefined) ?? [];

  const [allProjects, setAllProjects] = useState<Project[]>([]);
  useEffect(() => { getProjects().then(setAllProjects).catch(/* v8 ignore next */ () => {}); }, []);
  const projectOptions = allProjects.map(p => ({ value: p.id, label: p.name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={sectionLabel}><Bell size={11} /> Events</div>
        <MultiSelect
          options={EVENT_OPTIONS}
          value={events}
          onChange={v => onChange('events', v.length ? v : undefined)}
          placeholder="All events (leave empty for all)"
        />
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
          Leave empty to receive all events. Select specific events to filter.
        </p>
      </div>
      <div>
        <div style={sectionLabel}><FolderOpen size={11} /> Projects</div>
        <MultiSelect
          options={projectOptions}
          value={selectedProjects}
          onChange={v => onChange('projects', v.length ? v : undefined)}
          placeholder="All projects (leave empty for all)"
        />
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
          Leave empty to receive events from all projects.
        </p>
      </div>
      <div>
        <div style={sectionLabel}>Cooldown</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="form-input"
            type="number"
            min={0}
            style={{ width: 100 }}
            value={cooldownSeconds}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              onChange('cooldownSeconds', isNaN(v) || v <= 0 ? undefined : v);
            }}
            placeholder="0"
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>seconds (0 = no cooldown)</span>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
          Minimum interval before this channel can fire again for the same event.
        </p>
      </div>
    </div>
  );
}

/** Targets (roles/permissions/users) section (Recipients tab). */
export function RecipientsEditFields({
  form, onChange, roles, users,
}: TargetsProps) {
  const provider = form['provider'] as ChannelProvider;
  const roleOptions = roles.map(r => ({ value: r.id, label: r.name }));
  const userOptions = users.map(u => ({ value: u.id, label: u.email }));
  const hint = targetsHint(provider);
  const targets = (form['targets'] as { roles?: string[]; permissions?: string[]; users?: string[] } | undefined) ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sectionLabel}><Users size={11} /> Recipients / Targets</div>
      <div>
        <label className="form-label" style={{ fontSize: '0.78rem' }}>Roles</label>
        <MultiSelect
          options={roleOptions}
          value={targets.roles ?? []}
          onChange={v => onChange('targets', { ...targets, roles: v.length ? v : undefined })}
          placeholder="All roles (everyone)"
        />
      </div>
      <div>
        <label className="form-label" style={{ fontSize: '0.78rem' }}>Permissions</label>
        <MultiSelect
          options={PERM_OPTIONS}
          value={(targets.permissions ?? []) as string[]}
          onChange={v => onChange('targets', { ...targets, permissions: v.length ? (v as Permission[]) : undefined })}
          placeholder="All permissions (everyone)"
        />
      </div>
      <div>
        <label className="form-label" style={{ fontSize: '0.78rem' }}>Individual users</label>
        <MultiSelect
          options={userOptions}
          value={targets.users ?? []}
          onChange={v => onChange('targets', { ...targets, users: v.length ? v : undefined })}
          placeholder="All users (everyone)"
        />
      </div>
      {hint && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '6px 0 0', padding: '6px 8px', background: 'var(--bg-surface)', borderRadius: 4, borderLeft: '2px solid var(--border)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Combined events+targets block (kept for backward compat; not used by tabbed pages). */
export function EventsAndTargetsEditFields({ form, onChange, roles, users }: TargetsProps) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RoutingEditFields form={form} onChange={onChange} />
      <RecipientsEditFields form={form} onChange={onChange} roles={roles} users={users} />
    </div>
  );
}

/** Provider-specific form fields (excluding events/targets which are always shown). */
export function ChannelEditFields({ form, onChange, isEdit }: EditFieldsProps) {
  const provider = form['provider'] as ChannelProvider;
  switch (provider) {
    case 'dashboard':
      return (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Routes matching events to the in-app notification inbox. No credentials required.
        </p>
      );
    case 'smtp':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
            <EditInput label="Host" fieldKey="host" form={form} onChange={onChange} placeholder="smtp.example.com" required />
            <EditInput label="Port" fieldKey="port" form={{ ...form, port: String(form['port'] ?? '587') }} onChange={(k, v) => onChange(k, v ? Number(v) : undefined)} type="number" required />
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input id="smtp-tls" type="checkbox"
                checked={!!form['secure']}
                onChange={e => onChange('secure', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
              <label htmlFor="smtp-tls" style={{ cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-primary)' }}>Use TLS / SSL</label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {form['secure'] ? '(port 465 — direct SSL)' : '(port 587 — STARTTLS)'}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <EditInput label="Username" fieldKey="username" form={form} onChange={onChange} />
            <SecretEditInput label="Password" fieldKey="password" form={form} onChange={onChange} isEdit={isEdit} />
          </div>
        </>
      );
    case 'ses':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} />
          <EditInput label="AWS Region" fieldKey="region" form={form} onChange={onChange} placeholder="us-east-1" required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <EditInput label="Access Key ID" fieldKey="accessKeyId" form={form} onChange={onChange} />
            <SecretEditInput label="Secret Access Key" fieldKey="secretAccessKey" form={form} onChange={onChange} isEdit={isEdit} />
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Leave credentials blank to use the IAM instance role.</p>
        </>
      );
    case 'sendgrid':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} />
          <SecretEditInput label="API Key" fieldKey="apiKey" form={form} onChange={onChange} isEdit={isEdit} placeholder="SG.…" />
        </>
      );
    case 'azure':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} />
          <SecretEditInput label="Connection String" fieldKey="connectionString" form={form} onChange={onChange} isEdit={isEdit} />
        </>
      );
    case 'google':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} />
          <EditInput label="Client ID" fieldKey="clientId" form={form} onChange={onChange} required />
          <SecretEditInput label="Client Secret" fieldKey="clientSecret" form={form} onChange={onChange} isEdit={isEdit} />
          <SecretEditInput label="Refresh Token" fieldKey="refreshToken" form={form} onChange={onChange} isEdit={isEdit} />
        </>
      );
    case 'webhook':
      return (
        <>
          <EditInput label="URL" fieldKey="url" form={form} onChange={onChange} type="url" placeholder="https://example.com/webhook" required />
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Method</label>
              <select className="form-input" value={String(form['method'] ?? 'POST')} onChange={e => onChange('method', e.target.value)}>
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </div>
            <SecretEditInput label="Signing Secret" fieldKey="secret" form={form} onChange={onChange} isEdit={isEdit} placeholder="HMAC signing key" />
          </div>
        </>
      );
    case 'slack':
      return (
        <>
          <SecretEditInput label="Bot Token" fieldKey="botToken" form={form} onChange={onChange} isEdit={isEdit} placeholder="xoxb-…" />
          <EditInput label="Channel ID" fieldKey="channelId" form={form} onChange={onChange} placeholder="C1234567890" required />
        </>
      );
    case 'teams':
      return <SecretEditInput label="Webhook URL" fieldKey="webhookUrl" form={form} onChange={onChange} isEdit={isEdit} placeholder="https://outlook.office.com/webhook/…" />;
    case 'pagerduty':
      return <SecretEditInput label="Integration Key" fieldKey="integrationKey" form={form} onChange={onChange} isEdit={isEdit} placeholder="32-character routing key" />;
    case 'discord':
      return <SecretEditInput label="Webhook URL" fieldKey="webhookUrl" form={form} onChange={onChange} isEdit={isEdit} placeholder="https://discord.com/api/webhooks/…" />;
    default:
      return null;
  }
}

/** Provider label by key */
export function providerLabel(provider: string): string {
  return CHANNEL_PROVIDER_META.find(p => p.key === provider)?.label ?? provider;
}
