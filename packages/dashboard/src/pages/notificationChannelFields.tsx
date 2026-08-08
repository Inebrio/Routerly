/**
 * Shared field rendering for notification channel forms.
 * Used by Create, Edit, and Detail pages so the field list is defined once.
 */
import React, { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { Bell, Users, FolderOpen } from 'lucide-react';
import { CHANNEL_SECRET_FIELDS } from '@routerly/shared';
import { MultiSelect } from '../components/MultiSelect';
import { SearchableSelect } from '../components/SearchableSelect';
import { ALL_PERMISSIONS, getRouters } from '../api';
import type { Permission, Router } from '../api';
import type { Role, User } from '../api';

export type ChannelProvider =
  | 'smtp' | 'ses' | 'sendgrid' | 'azure' | 'google'
  | 'webhook' | 'slack' | 'teams' | 'pagerduty' | 'discord' | 'dashboard';

const CHANNEL_PROVIDER_KEYS: ChannelProvider[] = [
  'dashboard', 'smtp', 'ses', 'sendgrid', 'azure', 'google',
  'webhook', 'slack', 'teams', 'pagerduty', 'discord',
];

export function getChannelProviderMeta(t: TFunction): Array<{ key: ChannelProvider; label: string; description: string }> {
  return CHANNEL_PROVIDER_KEYS.map(key => ({
    key,
    label: t(`settings.notifications.providers.${key}.label`),
    description: t(`settings.notifications.providers.${key}.description`),
  }));
}

const REDACT_MARKER = '********';

export function isSecretField(provider: ChannelProvider, field: string): boolean {
  /* v8 ignore next */
  return (CHANNEL_SECRET_FIELDS[provider] ?? []).includes(field);
}

/** Returns true when the stored value is a masked marker (read from service). */
export function isMasked(value: unknown): boolean {
  return value === REDACT_MARKER;
}

// ── i18n key suffixes for the canonical events (see settings.notifications.events) ──
const EVENT_KEYS: Record<string, string> = {
  'provider.error':            'providerError',
  'provider.degraded':         'providerDegraded',
  'provider.recovered':        'providerRecovered',
  'provider.rate_limited':     'providerRateLimited',
  'routing.no_candidates':     'routingNoCandidates',
  'routing.fallback_used':     'routingFallbackUsed',
  'auth.login_failed':         'authLoginFailed',
  'auth.token_invalid':        'authTokenInvalid',
  'config.model_added':        'configModelAdded',
  'config.model_deleted':      'configModelDeleted',
  'config.router_created':     'configRouterCreated',
  'config.router_deleted':     'configRouterDeleted',
  'budget.threshold_reached':  'budgetThresholdReached',
  'budget.exceeded':           'budgetExceeded',
  'budget.reset':              'budgetReset',
  'system.startup':            'systemStartup',
  'system.shutdown':           'systemShutdown',
  'system.update_available':   'systemUpdateAvailable',
};

import { NOTIFICATION_EVENTS } from '@routerly/shared';
/* v8 ignore next */
export function getEventOptions(t: TFunction): Array<{ value: string; label: string }> {
  return NOTIFICATION_EVENTS.map(e => ({
    value: e,
    label: EVENT_KEYS[e] ? t(`settings.notifications.events.${EVENT_KEYS[e]}`) : e,
  }));
}

// ── i18n key suffixes for permissions (see settings.notifications.perms) ──
const PERM_KEYS: Record<Permission, string> = {
  'router:read':       'routerRead',
  'router:write':      'routerWrite',
  'model:read':        'modelRead',
  'model:write':       'modelWrite',
  'user:read':         'userRead',
  'user:write':        'userWrite',
  'report:read':       'reportRead',
  'settings:read':     'settingsRead',
  'settings:write':    'settingsWrite',
  'notification:write': 'notificationWrite',
  'token:read':        'tokenRead',
  'token:write':       'tokenWrite',
  'role:write':        'roleWrite',
  'audit:read':        'auditRead',
  'modules:read':      'modulesRead',
  'modules:manage':    'modulesManage',
  'connections:read':  'connectionsRead',
  'connections:manage': 'connectionsManage',
  'resilience:read':   'resilienceRead',
  'resilience:manage': 'resilienceManage',
  'profiles:read':     'profilesRead',
  'profiles:manage':   'profilesManage',
  'optimizers:read':   'optimizersRead',
  'optimizers:manage': 'optimizersManage',
  'experiments:read':  'experimentsRead',
  'experiments:manage': 'experimentsManage',
};
/* v8 ignore next */
export function getPermOptions(t: TFunction): Array<{ value: Permission; label: string }> {
  return ALL_PERMISSIONS.map(p => ({ value: p, label: t(`settings.notifications.perms.${PERM_KEYS[p]}`) }));
}

const FIXED_ENDPOINT_PROVIDERS: ChannelProvider[] = ['webhook', 'slack', 'teams', 'pagerduty', 'discord'];

export function targetsHint(provider: ChannelProvider, t: TFunction): string | null {
  if (FIXED_ENDPOINT_PROVIDERS.includes(provider)) {
    return t('settings.notifications.targetsHint.fixedEndpoint');
  }
  if (provider === 'dashboard') {
    return t('settings.notifications.targetsHint.dashboard');
  }
  return t('settings.notifications.targetsHint.email');
}

/** Summarise events + targets for list view. */
export function summariseChannel(ch: Record<string, unknown>, t: TFunction): string {
  const parts: string[] = [];
  const events = ch['events'] as string[] | undefined;
  const evCount = events?.length ?? 0;
  parts.push(evCount === 0
    ? t('settings.notifications.summary.allEvents')
    : t('settings.notifications.summary.eventCount', { count: evCount }));
  const targets = ch['targets'] as { roles?: string[]; permissions?: string[]; users?: string[] } | undefined;
  const targetParts: string[] = [];
  if (targets?.roles?.length) targetParts.push(t('settings.notifications.summary.roleCount', { count: targets.roles.length }));
  if (targets?.permissions?.length) targetParts.push(t('settings.notifications.summary.permCount', { count: targets.permissions.length }));
  if (targets?.users?.length) targetParts.push(t('settings.notifications.summary.userCount', { count: targets.users.length }));
  parts.push(targetParts.length ? targetParts.join(', ') : t('settings.notifications.summary.everyone'));
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

/**
 * Read-only view of provider-specific fields. Secrets shown as "Configured" / "Not set".
 * Not currently rendered by any page (kept for parity with the edit/create field sets and
 * covered by its own tests); out of scope for i18n until a page renders it.
 */
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
  t: TFunction;
}

function EditInput({
  label, fieldKey, form, onChange, type = 'text', placeholder, required, t,
}: {
  label: string; fieldKey: string; form: Record<string, unknown>; onChange: (k: string, v: unknown) => void;
  type?: string; placeholder?: string; required?: boolean; t: TFunction;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}{!required && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {t('settings.notifications.fields.optional')}</span>}</label>
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
  label, fieldKey, form, onChange, isEdit, placeholder: customPlaceholder, t,
}: {
  label: string; fieldKey: string; form: Record<string, unknown>; onChange: (k: string, v: unknown) => void;
  isEdit: boolean; placeholder?: string; t: TFunction;
}) {
  const placeholder = isEdit ? t('settings.notifications.fields.keepCurrentPlaceholder') : (customPlaceholder ?? '');
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

function EmailBaseFields({ form, onChange, t }: EditFieldsProps) {
  const provider = form['provider'] as ChannelProvider;
  /* v8 ignore next */
  if (provider === 'webhook' || provider === 'dashboard') return null;
  /* v8 ignore next */
  const fromAddress = typeof form['fromAddress'] === 'string' ? form['fromAddress'] : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">{t('settings.notifications.fields.labels.fromAddress')}</label>
        <input className="form-input" type="email"
          value={fromAddress}
          onChange={e => onChange('fromAddress', e.target.value)} placeholder={t('settings.notifications.fields.emailFromAddressPlaceholder')} required />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">{t('settings.notifications.fields.labels.fromName')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('settings.notifications.fields.optional')}</span></label>
        <input className="form-input"
          value={typeof form['fromName'] === 'string' ? form['fromName'] : ''}
          onChange={e => onChange('fromName', e.target.value || undefined)} placeholder={t('settings.notifications.fields.emailFromNamePlaceholder')} />
      </div>
    </div>
  );
}

type TargetsProps = {
  form: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  roles: Role[];
  users: User[];
  t: TFunction;
};

/** Events + Routers + Cooldown section (Routing tab). */
export function RoutingEditFields({
  form, onChange, t,
}: Pick<TargetsProps, 'form' | 'onChange' | 't'>) {
  const events = (form['events'] as string[] | undefined) ?? [];
  const cooldownSeconds = typeof form['cooldownSeconds'] === 'number' ? form['cooldownSeconds'] : 0;
  const selectedRouters = (form['routers'] as string[] | undefined) ?? [];

  const [allRouters, setAllRouters] = useState<Router[]>([]);
  useEffect(() => { getRouters().then(setAllRouters).catch(/* v8 ignore next */ () => {}); }, []);
  const routerOptions = allRouters.map(p => ({ value: p.id, label: p.name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={sectionLabel}><Bell size={11} /> {t('settings.notifications.fields.routing.eventsHeading')}</div>
        <MultiSelect
          options={getEventOptions(t)}
          value={events}
          onChange={v => onChange('events', v.length ? v : undefined)}
          placeholder={t('settings.notifications.fields.routing.eventsPlaceholder')}
        />
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
          {t('settings.notifications.fields.routing.eventsHint')}
        </p>
      </div>
      <div>
        <div style={sectionLabel}><FolderOpen size={11} /> {t('settings.notifications.fields.routing.routersHeading')}</div>
        <MultiSelect
          options={routerOptions}
          value={selectedRouters}
          onChange={v => onChange('routers', v.length ? v : undefined)}
          placeholder={t('settings.notifications.fields.routing.routersPlaceholder')}
        />
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
          {t('settings.notifications.fields.routing.routersHint')}
        </p>
      </div>
      <div>
        <div style={sectionLabel}>{t('settings.notifications.fields.routing.cooldownHeading')}</div>
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
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('settings.notifications.fields.routing.cooldownSuffix')}</span>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
          {t('settings.notifications.fields.routing.cooldownHint')}
        </p>
      </div>
    </div>
  );
}

/** Targets (roles/permissions/users) section (Recipients tab). */
export function RecipientsEditFields({
  form, onChange, roles, users, t,
}: TargetsProps) {
  const provider = form['provider'] as ChannelProvider;
  const roleOptions = roles.map(r => ({ value: r.id, label: r.name }));
  const userOptions = users.map(u => ({ value: u.id, label: u.email }));
  const hint = targetsHint(provider, t);
  const targets = (form['targets'] as { roles?: string[]; permissions?: string[]; users?: string[] } | undefined) ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sectionLabel}><Users size={11} /> {t('settings.notifications.fields.recipients.heading')}</div>
      <div>
        <label className="form-label" style={{ fontSize: '0.78rem' }}>{t('settings.notifications.fields.recipients.rolesLabel')}</label>
        <MultiSelect
          options={roleOptions}
          value={targets.roles ?? []}
          onChange={v => onChange('targets', { ...targets, roles: v.length ? v : undefined })}
          placeholder={t('settings.notifications.fields.recipients.rolesPlaceholder')}
        />
      </div>
      <div>
        <label className="form-label" style={{ fontSize: '0.78rem' }}>{t('settings.notifications.fields.recipients.permissionsLabel')}</label>
        <MultiSelect
          options={getPermOptions(t)}
          value={(targets.permissions ?? []) as string[]}
          onChange={v => onChange('targets', { ...targets, permissions: v.length ? (v as Permission[]) : undefined })}
          placeholder={t('settings.notifications.fields.recipients.permissionsPlaceholder')}
        />
      </div>
      <div>
        <label className="form-label" style={{ fontSize: '0.78rem' }}>{t('settings.notifications.fields.recipients.usersLabel')}</label>
        <MultiSelect
          options={userOptions}
          value={targets.users ?? []}
          onChange={v => onChange('targets', { ...targets, users: v.length ? v : undefined })}
          placeholder={t('settings.notifications.fields.recipients.usersPlaceholder')}
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
export function EventsAndTargetsEditFields({ form, onChange, roles, users, t }: TargetsProps) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RoutingEditFields form={form} onChange={onChange} t={t} />
      <RecipientsEditFields form={form} onChange={onChange} roles={roles} users={users} t={t} />
    </div>
  );
}

/** Provider-specific form fields (excluding events/targets which are always shown). */
export function ChannelEditFields({ form, onChange, isEdit, t }: EditFieldsProps) {
  const provider = form['provider'] as ChannelProvider;
  const F = 'settings.notifications.fields';
  const L = (key: string) => t(`${F}.labels.${key}`);
  switch (provider) {
    case 'dashboard':
      return (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t(`${F}.dashboardHint`)}
        </p>
      );
    case 'smtp':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} t={t} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
            <EditInput label={L('host')} fieldKey="host" form={form} onChange={onChange} placeholder={t(`${F}.smtpHostPlaceholder`)} required t={t} />
            <EditInput label={L('port')} fieldKey="port" form={{ ...form, port: String(form['port'] ?? '587') }} onChange={(k, v) => onChange(k, v ? Number(v) : undefined)} type="number" required t={t} />
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input id="smtp-tls" type="checkbox"
                checked={!!form['secure']}
                onChange={e => onChange('secure', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
              <label htmlFor="smtp-tls" style={{ cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-primary)' }}>{t(`${F}.smtpTlsLabel`)}</label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {form['secure'] ? t(`${F}.smtpTlsOnHint`) : t(`${F}.smtpTlsOffHint`)}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <EditInput label={L('username')} fieldKey="username" form={form} onChange={onChange} t={t} />
            <SecretEditInput label={L('password')} fieldKey="password" form={form} onChange={onChange} isEdit={isEdit} t={t} />
          </div>
        </>
      );
    case 'ses':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} t={t} />
          <EditInput label={L('awsRegion')} fieldKey="region" form={form} onChange={onChange} placeholder={t(`${F}.sesRegionPlaceholder`)} required t={t} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <EditInput label={L('accessKeyId')} fieldKey="accessKeyId" form={form} onChange={onChange} t={t} />
            <SecretEditInput label={L('secretAccessKey')} fieldKey="secretAccessKey" form={form} onChange={onChange} isEdit={isEdit} t={t} />
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{t(`${F}.sesIamHint`)}</p>
        </>
      );
    case 'sendgrid':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} t={t} />
          <SecretEditInput label={L('apiKey')} fieldKey="apiKey" form={form} onChange={onChange} isEdit={isEdit} placeholder={t(`${F}.sendgridApiKeyPlaceholder`)} t={t} />
        </>
      );
    case 'azure':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} t={t} />
          <SecretEditInput label={L('connectionString')} fieldKey="connectionString" form={form} onChange={onChange} isEdit={isEdit} t={t} />
        </>
      );
    case 'google':
      return (
        <>
          <EmailBaseFields form={form} onChange={onChange} isEdit={isEdit} t={t} />
          <EditInput label={L('clientId')} fieldKey="clientId" form={form} onChange={onChange} required t={t} />
          <SecretEditInput label={L('clientSecret')} fieldKey="clientSecret" form={form} onChange={onChange} isEdit={isEdit} t={t} />
          <SecretEditInput label={L('refreshToken')} fieldKey="refreshToken" form={form} onChange={onChange} isEdit={isEdit} t={t} />
        </>
      );
    case 'webhook':
      return (
        <>
          <EditInput label={L('url')} fieldKey="url" form={form} onChange={onChange} type="url" placeholder={t(`${F}.webhookUrlPlaceholder`)} required t={t} />
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">{L('method')}</label>
              <SearchableSelect
                options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }]}
                value={String(form['method'] ?? 'POST')}
                onChange={v => onChange('method', v)}
              />
            </div>
            <SecretEditInput label={L('signingSecret')} fieldKey="secret" form={form} onChange={onChange} isEdit={isEdit} placeholder={t(`${F}.webhookSecretPlaceholder`)} t={t} />
          </div>
        </>
      );
    case 'slack':
      return (
        <>
          <SecretEditInput label={L('botToken')} fieldKey="botToken" form={form} onChange={onChange} isEdit={isEdit} placeholder={t(`${F}.slackBotTokenPlaceholder`)} t={t} />
          <EditInput label={L('channelId')} fieldKey="channelId" form={form} onChange={onChange} placeholder={t(`${F}.slackChannelIdPlaceholder`)} required t={t} />
        </>
      );
    case 'teams':
      return <SecretEditInput label={L('webhookUrl')} fieldKey="webhookUrl" form={form} onChange={onChange} isEdit={isEdit} placeholder={t(`${F}.teamsWebhookPlaceholder`)} t={t} />;
    case 'pagerduty':
      return <SecretEditInput label={L('integrationKey')} fieldKey="integrationKey" form={form} onChange={onChange} isEdit={isEdit} placeholder={t(`${F}.pagerdutyKeyPlaceholder`)} t={t} />;
    case 'discord':
      return <SecretEditInput label={L('webhookUrl')} fieldKey="webhookUrl" form={form} onChange={onChange} isEdit={isEdit} placeholder={t(`${F}.discordWebhookPlaceholder`)} t={t} />;
    default:
      return null;
  }
}

/** Provider label by key */
export function providerLabel(provider: string, t: TFunction): string {
  return CHANNEL_PROVIDER_KEYS.includes(provider as ChannelProvider)
    ? t(`settings.notifications.providers.${provider}.label`)
    : provider;
}
