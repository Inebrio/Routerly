import React, { useEffect, useRef, useState } from 'react';
import { Save, Plus, Trash2, Mail, Search, ChevronDown, ChevronRight, ChevronUp, Globe, BarChart2, Bell, Users, GitBranch, Activity, TrendingUp, Database, Webhook, Dog, Copy, Check, Shield } from 'lucide-react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { getSettings, updateSettings, getSystemInfo, testNotificationChannel, checkForUpdates, triggerUpdate, getAvailableReleases, getRoles, getUsers, ALL_PERMISSIONS, getIntegrations, createIntegration, updateIntegration, deleteIntegration, testIntegration, refreshCatalog, getCatalogStatus, probeRepo } from '../api';
import type { Settings, SystemInfo, UpdateInfo, AvailableReleases, Role, User, Permission, Integration, IntegrationTraces, IntegrationType, ProviderRepo, RepoStatus } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MultiSelect } from '../components/MultiSelect';
import { SearchableSelect } from '../components/SearchableSelect';
import { writeToClipboard } from '../utils/clipboard';
import { NOTIFICATION_EVENTS } from '@routerly/shared';

const LOG_LEVELS: Settings['logLevel'][] = ['trace', 'debug', 'info', 'warn', 'error'];

// ── Telemetry section (self-saving) ──────────────────────────────────────────

function TelemetrySection({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = settings.telemetry;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function toggle(enabled: boolean) {
    setSaving(true);
    setError('');
    try {
      const updated = await updateSettings({ telemetry: { enabled } } as Partial<Settings>);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <BarChart2 size={13} /> Anonymous Metrics
      </h3>

      <div style={{ padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
        <p style={{ fontSize: '0.83rem', color: 'var(--text-primary)', margin: '0 0 4px' }}>
          <strong>Routerly never sends data automatically.</strong>{' '}
          {t === undefined
            ? 'You have not made a choice yet.'
            : t.enabled
              ? 'Anonymous install metrics are enabled.'
              : 'Anonymous install metrics are disabled.'}
        </p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          When enabled, Routerly sends only: event type (install / upgrade / uninstall), version, platform, and a random ID.
          No personal data, no usage data, no IP stored.{' '}
          <a href="https://doc.routerly.ai/next/reference/telemetry" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            What is sent?
          </a>
        </p>

        {t?.enabled && t.installId && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 12px', fontFamily: 'monospace' }}>
            Install ID: {t.installId}
          </p>
        )}

        {error && <p style={{ fontSize: '0.78rem', color: 'var(--error, #e53e3e)', margin: '0 0 10px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className={`btn btn-sm ${t?.enabled ? 'btn-primary' : 'btn-secondary'}`}
            disabled={saving || t?.enabled === true}
            onClick={() => toggle(true)}
            style={{ fontSize: '0.8rem' }}
          >
            {saving && !t?.enabled ? <><div className="spinner" style={{ width: 11, height: 11 }} /> Saving…</> : 'Enable'}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${t?.enabled === false ? 'btn-primary' : 'btn-secondary'}`}
            disabled={saving || t?.enabled === false}
            onClick={() => toggle(false)}
            style={{ fontSize: '0.8rem' }}
          >
            {saving && t?.enabled ? <><div className="spinner" style={{ width: 11, height: 11 }} /> Saving…</> : 'Disable'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────

/** Which addresses only work on this machine, so the list says it instead of implying it. */
function addressScope(address: string): string {
  return /\/\/(127\.|\[?::1\]?|localhost)/.test(address) ? 'This machine' : 'Network';
}


export function SettingsGeneralTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [form, setForm] = useState<Partial<Settings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const s = await getSettings();
      setSettings(s);
      setForm({ logLevel: s.logLevel, publicUrl: s.publicUrl || `http://localhost:${s.port}`, ...(s.notifications ? { notifications: s.notifications } : {}) });
      // Version and uptime live on /api/system/info; a failure there must not hide the settings form.
      getSystemInfo().then(setInfo).catch(() => setInfo(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function copyAddress(address: string) {
    try {
      await writeToClipboard(address);
      setCopied(address);
      setTimeout(/* v8 ignore next */ () => setCopied(null), 2000);
    } catch { /* silently ignore — the address is selectable text */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateSettings(form);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function field<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f: Partial<Settings>) => ({ ...f, [key]: value }));
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;
  /* v8 ignore next */
  if (!settings) return <div className="form-error" style={{ margin: 24 }}>{error || 'Failed to load settings.'}</div>;

  // Older services do not report the resolved interfaces: fall back to the bind address.
  const listenAddresses = settings.listeningAddresses?.length
    ? settings.listeningAddresses
    : [`http://${settings.host}:${settings.port}`];

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
          Server Info
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Read-only. Host and port come from the environment or the settings file, not from here.
        </p>

        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          {listenAddresses.length === 1 ? 'Reachable at' : 'Reachable at any of these addresses'}
        </div>
        {listenAddresses.map(address => (
          <div key={address} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-input, var(--bg-tertiary, var(--bg-secondary)))', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', minWidth: 0 }}>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {address}
              </span>
              <span className="badge badge-neutral" style={{ flexShrink: 0 }}>{addressScope(address)}</span>
            </div>
            <button
              type="button"
              onClick={() => copyAddress(address)}
              className="btn btn-secondary"
              aria-label={`Copy ${address}`}
              style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {copied === address ? <Check size={13} /> : <Copy size={13} />}
              {copied === address ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ))}

        <div style={{ marginTop: 14 }}>
          <InfoRow label="Host and port" value={`${settings.host}:${settings.port}`} mono />
          {info && <InfoRow label="Version" value={info.version} mono />}
          {info && <InfoRow label="Uptime" value={formatUptime(info.uptimeSeconds)} />}
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
          Runtime Settings
        </h3>

        <div className="form-group">
          <label className="form-label">Log Level</label>
          <SearchableSelect
            options={LOG_LEVELS.map(l => ({ value: l, label: l }))}
            value={form.logLevel ?? 'info'}
            placeholder="Log Level"
            ariaLabel="Log Level"
            onChange={v => field('logLevel', v as Settings['logLevel'])}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Controls the verbosity of service logs.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="s-publicurl">Public URL</label>
          <input
            id="s-publicurl"
            className="form-input"
            type="url"
            placeholder={`http://${settings?.host === '0.0.0.0' ? '<your-ip>' : (settings?.host ?? 'localhost')}:${settings?.port ?? 3000}`}
            value={form.publicUrl ?? ''}
            onChange={e => field('publicUrl', e.target.value)}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Base URL at which the service is reachable from external clients (e.g. <code>http://192.168.1.10:3000</code>).
            Used in the <strong>How to connect</strong> section of each project.
            Useful when the dashboard runs on a different machine or port than the service.
          </p>
        </div>

      </div>

      <TelemetrySection
        settings={settings!}
        onSaved={updated => setSettings(updated)}
      />

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {saved && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.85rem', color: '#22c55e' }}>
          Settings saved successfully.
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : <><Save size={15} /> Save Settings</>}
        </button>
      </div>

    </form>
  );
}

// ── Notifications tab ────────────────────────────────────────────────────────

type NotifForm = { notifications?: import('../api').NotificationsConfig };
type EProvider = import('../api').ChannelProvider;
type EChannel  = import('../api').NotificationChannel;

const CHANNEL_PROVIDERS: Array<{ key: EProvider; label: string; description: string }> = [
  { key: 'dashboard',  label: 'Dashboard (in-app inbox)', description: 'Routes events to the in-app inbox' },
  { key: 'smtp',       label: 'SMTP',               description: 'Custom mail server' },
  { key: 'ses',        label: 'Amazon SES',          description: 'AWS Simple Email Service' },
  { key: 'sendgrid',   label: 'SendGrid',            description: 'Twilio SendGrid' },
  { key: 'azure',      label: 'Azure Communication', description: 'Azure Communication Services' },
  { key: 'google',     label: 'Google / Gmail',       description: 'Gmail via OAuth2' },
  { key: 'webhook',    label: 'Webhook',             description: 'HTTP webhook callback' },
  { key: 'slack',      label: 'Slack',               description: 'Slack Bot API' },
  { key: 'teams',      label: 'Microsoft Teams',     description: 'Teams Incoming Webhook' },
  { key: 'pagerduty',  label: 'PagerDuty',           description: 'PagerDuty Events API v2' },
  { key: 'discord',    label: 'Discord',             description: 'Discord Webhook' },
];

// Readable labels for the canonical events
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

/* v8 ignore next */
const EVENT_OPTIONS = NOTIFICATION_EVENTS.map(e => ({ value: e, label: EVENT_LABELS[e] ?? e }));

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
  'modules:read':       'Modules – Read',
  'modules:manage':     'Modules – Manage',
  'connections:read':   'Connections – Read',
  'connections:manage': 'Connections – Manage',
  'resilience:read':    'Resilience – Read',
  'resilience:manage':  'Resilience – Manage',
  'profiles:read':      'Routing Profiles – Read',
  'profiles:manage':    'Routing Profiles – Manage',
  'optimizers:read':    'Optimizers – Read',
  'optimizers:manage':  'Optimizers – Manage',
  'experiments:read':   'Experiments – Read',
  'experiments:manage': 'Experiments – Manage',
};

/* v8 ignore next */
const PERM_OPTIONS = ALL_PERMISSIONS.map(p => ({ value: p, label: PERM_LABELS_LOCAL[p] ?? p }));

/** Fixed-endpoint channels: targets change inbox visibility/email recipients, but don't change the actual delivery destination */
const FIXED_ENDPOINT_PROVIDERS: EProvider[] = ['webhook', 'slack', 'teams', 'pagerduty', 'discord'];

function targetsHint(provider: EProvider): string | null {
  if (FIXED_ENDPOINT_PROVIDERS.includes(provider)) {
    return 'For this channel type, targets do not change delivery (the endpoint is fixed). They filter which events are logged in the audit trail per recipient.';
  }
  if (provider === 'dashboard') {
    return 'Targets control inbox visibility — only the matched users will see these notifications in their in-app inbox.';
  }
  // email providers
  return 'Targets determine which users receive this email. Leave all empty to send to all users.';
}

/** Summarise events + targets for collapsed card view */
function summariseChannel(ch: EChannel): string {
  const parts: string[] = [];
  const evCount = ch.events?.length ?? 0;
  parts.push(evCount === 0 ? 'All events' : `${evCount} event${evCount > 1 ? 's' : ''}`);
  const t = ch.targets;
  const targetParts: string[] = [];
  if (t?.roles?.length) targetParts.push(`${t.roles.length} role${t.roles.length > 1 ? 's' : ''}`);
  if (t?.permissions?.length) targetParts.push(`${t.permissions.length} perm${t.permissions.length > 1 ? 's' : ''}`);
  if (t?.users?.length) targetParts.push(`${t.users.length} user${t.users.length > 1 ? 's' : ''}`);
  parts.push(targetParts.length ? targetParts.join(', ') : 'Everyone');
  return parts.join(' · ');
}

function migrateNotifications(raw: unknown): import('../api').NotificationsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  // New format already
  if (Array.isArray(r.channels)) return raw as import('../api').NotificationsConfig;
  // Old format: per-provider keys → migrate to channels array
  const providers = ['smtp', 'ses', 'sendgrid', 'azure', 'google'] as const;
  const channels: EChannel[] = [];
  for (const p of providers) {
    if (r[p] && typeof r[p] === 'object') {
      channels.push({ id: `migrated_${p}`, ...(r[p] as object) } as EChannel);
    }
  }
  return channels.length ? { channels } : undefined;
}

export function SettingsNotificationsTab() {
  const [form, setForm]       = useState<NotifForm>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');
  const [addOpen, setAddOpen]             = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [collapsed, setCollapsed]         = useState<Record<string, boolean>>({});
  const [testTo, setTestTo]               = useState<Record<string, string>>({});
  const [testStatus, setTestStatus]       = useState<Record<string, { loading: boolean; ok?: boolean; message?: string; warn?: boolean }>>({});
  const [roles, setRoles]   = useState<Role[]>([]);
  const [users, setUsers]   = useState<User[]>([]);

  const addRef    = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false); setChannelSearch('');
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  useEffect(() => {
    if (addOpen) setTimeout(() => searchRef.current?.focus(), 0);
    else setChannelSearch('');
  }, [addOpen]);

  useEffect(() => {
    getSettings()
      .then(s => {
        const notif = migrateNotifications(s.notifications as unknown);
        setForm(notif ? { notifications: notif } : {});
        const ids = notif?.channels?.map(ch => ch.id) ?? [];
        if (ids.length) setCollapsed(Object.fromEntries(ids.map(id => [id, true])));
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
    // ponytail: load roles + users in parallel for targets editor; failures are non-fatal
    getRoles().then(setRoles).catch(() => {});
    getUsers().then(setUsers).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaving(true); setSaved(false);
    try {
      // Strip empty events/targets before saving
      const cleanChannels = form.notifications
        ? (form.notifications.channels ?? []).map(ch => {
            const out: EChannel = { ...ch };
            if (!out.events?.length) delete out.events;
            if (out.targets) {
              const t = out.targets;
              const clean: import('../api').ChannelTargets = {};
              if (t.roles?.length)       clean.roles       = t.roles;
              if (t.permissions?.length) clean.permissions = t.permissions;
              if (t.users?.length)       clean.users       = t.users;
              if (Object.keys(clean).length) out.targets = clean;
              else delete out.targets;
            }
            return out;
          })
        : undefined;
      await updateSettings(cleanChannels !== undefined
        ? { ...form, notifications: { ...form.notifications, channels: cleanChannels } }
        : form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  const channels = form.notifications?.channels ?? [];

  function nextId() { return `ch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

  function addChannel(provider: EProvider) {
    setAddOpen(false);
    const id = nextId();
    const defaults: Record<EProvider, EChannel> = {
      dashboard: { id, provider: 'dashboard' },
      smtp:      { id, provider: 'smtp',      fromAddress: '', host: '', port: 587, secure: false },
      ses:       { id, provider: 'ses',       fromAddress: '', region: '' },
      sendgrid:  { id, provider: 'sendgrid',  fromAddress: '', apiKey: '' },
      azure:     { id, provider: 'azure',     fromAddress: '', connectionString: '' },
      google:    { id, provider: 'google',    fromAddress: '', clientId: '', clientSecret: '', refreshToken: '' },
      webhook:   { id, provider: 'webhook',   url: '' },
      slack:     { id, provider: 'slack',     botToken: '', channelId: '' },
      teams:     { id, provider: 'teams',     webhookUrl: '' },
      pagerduty: { id, provider: 'pagerduty', integrationKey: '' },
      discord:   { id, provider: 'discord',   webhookUrl: '' },
    };
    setForm(f => ({ ...f, notifications: { ...f.notifications, channels: [...(f.notifications?.channels ?? []), defaults[provider]] } }));
    setCollapsed(c => ({ ...c, [id]: false }));
  }

  function removeChannel(id: string) {
    /* v8 ignore next */
    setForm(f => ({ ...f, notifications: { ...f.notifications, channels: (f.notifications?.channels ?? []).filter(ch => ch.id !== id) } }));
  }

  function uf(id: string, field: string, value: unknown) {
    setForm(f => ({
      ...f,
      /* v8 ignore next */
      notifications: { ...f.notifications, channels: (f.notifications?.channels ?? []).map(ch => ch.id === id ? ({ ...ch, [field]: value } as EChannel) : ch) },
    }));
  }

  async function sendTest(id: string, provider: EProvider) {
    const to = (testTo[id] ?? '').trim();
    /* v8 ignore next */
    if (provider !== 'webhook' && provider !== 'dashboard' && !to) return;
    setTestStatus(s => ({ ...s, [id]: { loading: true } }));
    try {
      const res = await testNotificationChannel(id, to);
      if (res.fixedSecure !== undefined) uf(id, 'secure', res.fixedSecure);
      setTestStatus(s => ({ ...s, [id]: { loading: false, ok: res.ok, message: res.message, warn: res.fixedSecure !== undefined } }));
    } catch (e) {
      setTestStatus(s => ({ ...s, [id]: { loading: false, ok: false, message: e instanceof Error ? e.message : String(e) } }));
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  const cardHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8,
    display: 'flex', alignItems: 'center', gap: 5,
  };

  function removeActions(id: string) {
    if (pendingDelete === id) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Remove channel?</span>
          <button type="button" onClick={() => { removeChannel(id); setPendingDelete(null); }}
            style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.1)', color: 'rgb(239,68,68)', cursor: 'pointer' }}>
            Remove
          </button>
          <button type="button" onClick={() => setPendingDelete(null)}
            style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button type="button" onClick={() => setPendingDelete(id)} title="Remove channel"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center' }}>
        <Trash2 size={14} />
      </button>
    );
  }

  function testRow(ch: EChannel) {
    if (ch.provider === 'dashboard') return null; // ponytail: no test delivery for inbox channel
    const st = testStatus[ch.id];
    const noRecipient = ch.provider === 'webhook' || ch.provider === 'slack' || ch.provider === 'teams' || ch.provider === 'pagerduty' || ch.provider === 'discord';
    return (
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={sectionLabelStyle}>Send test</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!noRecipient && (
            <input type="email" className="form-input" style={{ flex: 1, margin: 0 }}
              placeholder="recipient@example.com"
              value={testTo[ch.id] ?? ''}
              onChange={e => setTestTo(t => ({ ...t, [ch.id]: e.target.value }))} />
          )}
          <button type="button" className="btn btn-secondary"
            disabled={st?.loading || (!noRecipient && !testTo[ch.id]?.trim())}
            onClick={() => sendTest(ch.id, ch.provider)}
            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            {st?.loading
              ? <><div className="spinner" style={{ width: 12, height: 12 }} /> Sending…</>
              : 'Send Test'}
          </button>
        </div>
        {st && !st.loading && (
          <div style={{
            fontSize: '0.8rem', padding: '6px 10px', borderRadius: 6,
            background: st.warn ? 'rgba(234,179,8,0.1)' : st.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${st.warn ? 'rgba(234,179,8,0.4)' : st.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: st.warn ? '#ca8a04' : st.ok ? '#22c55e' : '#ef4444',
          }}>
            {st.warn ? '⚠ ' : st.ok ? '✓ ' : '✕ '}{st.message}
            {st.warn && <><br /><span style={{ fontSize: '0.72rem', opacity: 0.8 }}>Form updated — save to apply.</span></>}
          </div>
        )}
      </div>
    );
  }

  function emailBaseFields(ch: EChannel) {
    /* v8 ignore next */
    if (ch.provider === 'webhook' || ch.provider === 'dashboard') return null;
    const c = ch as { fromAddress: string; fromName?: string };
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">From Address</label>
          <input className="form-input" type="email" value={c.fromAddress} required
            onChange={e => uf(ch.id, 'fromAddress', e.target.value)} placeholder="noreply@example.com" />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">From Name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input className="form-input" value={c.fromName ?? ''}
            onChange={e => uf(ch.id, 'fromName', e.target.value || undefined)} placeholder="Routerly" />
        </div>
      </div>
    );
  }

  /** Events + Targets editor — rendered inside every channel's expanded form */
  function eventsAndTargetsFields(ch: EChannel) {
    const roleOptions = roles.map(r => ({ value: r.id, label: r.name }));
    const userOptions = users.map(u => ({ value: u.id, label: u.email }));
    const hint = targetsHint(ch.provider);

    return (
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Events */}
        <div>
          <div style={sectionLabelStyle}><Bell size={11} /> Events</div>
          <MultiSelect
            options={EVENT_OPTIONS}
            value={ch.events ?? []}
            onChange={v => uf(ch.id, 'events', v.length ? v : undefined)}
            placeholder="All events (leave empty for all)"
          />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '5px 0 0' }}>
            Leave empty to receive all events. Select specific events to filter.
          </p>
        </div>

        {/* Targets */}
        <div>
          <div style={sectionLabelStyle}><Users size={11} /> Recipients / Targets</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Roles</label>
              <MultiSelect
                options={roleOptions}
                value={ch.targets?.roles ?? []}
                onChange={v => uf(ch.id, 'targets', { ...(ch.targets ?? {}), roles: v.length ? v : undefined })}
                placeholder="All roles (everyone)"
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Permissions</label>
              <MultiSelect
                options={PERM_OPTIONS}
                value={(ch.targets?.permissions ?? []) as string[]}
                onChange={v => uf(ch.id, 'targets', { ...(ch.targets ?? {}), permissions: v.length ? (v as Permission[]) : undefined })}
                placeholder="All permissions (everyone)"
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Individual users</label>
              <MultiSelect
                options={userOptions}
                value={ch.targets?.users ?? []}
                onChange={v => uf(ch.id, 'targets', { ...(ch.targets ?? {}), users: v.length ? v : undefined })}
                placeholder="All users (everyone)"
              />
            </div>
          </div>
          {hint && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '6px 0 0', padding: '6px 8px', background: 'var(--bg-surface)', borderRadius: 4, borderLeft: '2px solid var(--border)' }}>
              {hint}
            </p>
          )}
        </div>
      </div>
    );
  }

  function channelFields(ch: EChannel) {
    switch (ch.provider) {
      case 'dashboard': return (
        <>
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Routes matching events to the in-app notification inbox. No credentials required.
          </p>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'smtp': return (
        <>
          {emailBaseFields(ch)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Host</label>
              <input className="form-input" value={ch.host}
                onChange={e => uf(ch.id, 'host', e.target.value)} placeholder="smtp.example.com" required />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input className="form-input" type="number" value={ch.port}
                onChange={e => uf(ch.id, 'port', Number(e.target.value))} required />
            </div>
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input id={`smtp-tls-${ch.id}`} type="checkbox" checked={ch.secure}
                onChange={e => {
                  const secure = e.target.checked;
                  const cur = ch.port ?? 587;
                  const port = secure ? (cur === 587 ? 465 : cur) : (cur === 465 ? 587 : cur);
                  /* v8 ignore next */
                  setForm(f => ({ ...f, notifications: { ...f.notifications, channels: (f.notifications?.channels ?? []).map(c => c.id === ch.id ? { ...c, secure, port } : c) } }));
                }}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
              <label htmlFor={`smtp-tls-${ch.id}`} style={{ cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-primary)' }}>Use TLS / SSL</label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {ch.secure ? '(port 465 — direct SSL)' : '(port 587 — STARTTLS)'}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Username <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" value={ch.username ?? ''} onChange={e => uf(ch.id, 'username', e.target.value || undefined)} />
            </div>
            <div className="form-group">
              <label className="form-label">Password <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" type="password" value={ch.password ?? ''} onChange={e => uf(ch.id, 'password', e.target.value || undefined)} />
            </div>
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'ses': return (
        <>
          {emailBaseFields(ch)}
          <div className="form-group">
            <label className="form-label">AWS Region</label>
            <input className="form-input" value={ch.region} onChange={e => uf(ch.id, 'region', e.target.value)} placeholder="us-east-1" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Access Key ID <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" value={ch.accessKeyId ?? ''} onChange={e => uf(ch.id, 'accessKeyId', e.target.value || undefined)} />
            </div>
            <div className="form-group">
              <label className="form-label">Secret Access Key <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" type="password" value={ch.secretAccessKey ?? ''} onChange={e => uf(ch.id, 'secretAccessKey', e.target.value || undefined)} />
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Leave credentials blank to use the IAM instance role.</p>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'sendgrid': return (
        <>
          {emailBaseFields(ch)}
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input className="form-input" type="password" value={ch.apiKey} onChange={e => uf(ch.id, 'apiKey', e.target.value)} required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'azure': return (
        <>
          {emailBaseFields(ch)}
          <div className="form-group">
            <label className="form-label">Connection String</label>
            <input className="form-input" value={ch.connectionString} onChange={e => uf(ch.id, 'connectionString', e.target.value)} required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'google': return (
        <>
          {emailBaseFields(ch)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Client ID</label>
              <input className="form-input" value={ch.clientId} onChange={e => uf(ch.id, 'clientId', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input className="form-input" type="password" value={ch.clientSecret} onChange={e => uf(ch.id, 'clientSecret', e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Refresh Token</label>
            <input className="form-input" type="password" value={ch.refreshToken} onChange={e => uf(ch.id, 'refreshToken', e.target.value)} required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'webhook': return (
        <>
          <div className="form-group">
            <label className="form-label">URL</label>
            <input className="form-input" type="url" value={ch.url} onChange={e => uf(ch.id, 'url', e.target.value)} placeholder="https://example.com/webhook" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Method</label>
              <SearchableSelect
                options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }]}
                value={ch.method ?? 'POST'}
                onChange={v => uf(ch.id, 'method', v)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Secret <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" type="password" value={ch.secret ?? ''} onChange={e => uf(ch.id, 'secret', e.target.value || undefined)} placeholder="HMAC signing key" />
            </div>
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'slack': return (
        <>
          <div className="form-group">
            <label className="form-label">Bot Token</label>
            <input className="form-input" type="password" value={ch.botToken} onChange={e => uf(ch.id, 'botToken', e.target.value)} placeholder="xoxb-…" required />
          </div>
          <div className="form-group">
            <label className="form-label">Channel ID</label>
            <input className="form-input" value={ch.channelId} onChange={e => uf(ch.id, 'channelId', e.target.value)} placeholder="C1234567890" required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'teams': return (
        <>
          <div className="form-group">
            <label className="form-label">Webhook URL</label>
            <input className="form-input" type="url" value={ch.webhookUrl} onChange={e => uf(ch.id, 'webhookUrl', e.target.value)} placeholder="https://outlook.office.com/webhook/…" required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'pagerduty': return (
        <>
          <div className="form-group">
            <label className="form-label">Integration Key</label>
            <input className="form-input" type="password" value={ch.integrationKey} onChange={e => uf(ch.id, 'integrationKey', e.target.value)} placeholder="32-character routing key" required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
      case 'discord': return (
        <>
          <div className="form-group">
            <label className="form-label">Webhook URL</label>
            <input className="form-input" type="url" value={ch.webhookUrl} onChange={e => uf(ch.id, 'webhookUrl', e.target.value)} placeholder="https://discord.com/api/webhooks/…" required />
          </div>
          {eventsAndTargetsFields(ch)}
        </>
      );
    }
  }

  const filteredToAdd = channelSearch.trim()
    ? CHANNEL_PROVIDERS.filter(p =>
        p.label.toLowerCase().includes(channelSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(channelSearch.toLowerCase()))
    : CHANNEL_PROVIDERS;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 600 }}>
      {channels.length === 0 && (
        <div style={{ padding: '40px 0 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No notification channels configured yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: channels.length > 0 ? 16 : 0 }}>
        {channels.map(ch => {
          /* v8 ignore next */
          const isCollapsed = collapsed[ch.id] ?? false;
          const meta = CHANNEL_PROVIDERS.find(p => p.key === ch.provider);
          const isDashboard = ch.provider === 'dashboard';
          const isNonEmail = isDashboard || ch.provider === 'webhook' || ch.provider === 'slack' || ch.provider === 'teams' || ch.provider === 'pagerduty' || ch.provider === 'discord';
          return (
            <div key={ch.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {/* Card header — always visible */}
              <div style={cardHeaderStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <button type="button"
                    onClick={() => setCollapsed(c => ({ ...c, [ch.id]: !isCollapsed }))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', flexShrink: 0 }}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {isDashboard
                    ? <Bell size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    : isNonEmail
                      ? <Globe size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                      : <Mail  size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{meta?.label}</span>
                  <input value={ch.name ?? ''}
                    onChange={e => uf(ch.id, 'name', e.target.value || undefined)}
                    placeholder="Label (optional)"
                    style={{ background: 'none', border: 'none', outline: 'none', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, flex: 1 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {/* Collapsed summary: events + targets at a glance */}
                  {isCollapsed && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {summariseChannel(ch)}
                    </span>
                  )}
                  {removeActions(ch.id)}
                </div>
              </div>
              {!isCollapsed && (
                <>
                  <div style={{ padding: 16 }}>{channelFields(ch)}</div>
                  {testRow(ch)}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Add Channel ── */}
      <div ref={addRef} style={{ position: 'relative', display: 'inline-block', marginBottom: 24 }}>
        <button type="button" className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setAddOpen(o => !o)}>
          <Plus size={14} /> Add Channel
        </button>
        {addOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: 280, zIndex: 100, overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input ref={searchRef} type="text" value={channelSearch}
                onChange={e => setChannelSearch(e.target.value)} placeholder="Search channels…"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.85rem', color: 'var(--text-primary)' }} />
            </div>
            {filteredToAdd.length === 0
              ? <div style={{ padding: '10px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No results</div>
              : filteredToAdd.map((ch, i) => (
                  <button key={ch.key} type="button" onClick={() => addChannel(ch.key)}
                    style={{
                      display: 'flex', flexDirection: 'column', width: '100%',
                      padding: '10px 14px', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      borderBottom: i < filteredToAdd.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{ch.label}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ch.description}</span>
                  </button>
                ))}
          </div>
        )}
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {saved && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.85rem', color: '#22c55e' }}>
          Settings saved successfully.
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : <><Save size={15} /> Save Settings</>}
        </button>
      </div>
    </form>
  );
}

// ── Integrations tab ─────────────────────────────────────────────────────────

const INTEGRATION_TYPES: Array<{ type: IntegrationType; label: string; description: string; Icon: React.ElementType }> = [
  { type: 'prometheus', label: 'Prometheus',     description: 'pull — exposes /metrics',      Icon: BarChart2   },
  { type: 'otel',       label: 'OpenTelemetry',  description: 'push — OTLP HTTP',             Icon: GitBranch   },
  { type: 'datadog',    label: 'Datadog',         description: 'push — metrics API',           Icon: Dog         },
  { type: 'grafana',    label: 'Grafana Cloud',   description: 'push — remote_write',          Icon: TrendingUp  },
  { type: 'influxdb',   label: 'InfluxDB',        description: 'push — line protocol',         Icon: Database    },
  { type: 'webhook',    label: 'Webhook',          description: 'push — HTTP POST JSON',        Icon: Webhook     },
];

const DATADOG_SITES = ['datadoghq.com', 'datadoghq.eu', 'us3.datadoghq.com', 'us5.datadoghq.com', 'ddog-gov.com'] as const;

/** Convert Record<string, string> to "key: value\nkey: value" for textarea display */
function headersToText(h?: Record<string, string>): string {
  if (!h) return '';
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/** Parse "key: value" lines back to Record<string, string> */
function textToHeaders(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) result[k] = v;
  }
  return result;
}

/**
 * Trace export opt-in, offered only by the sinks that can carry a per-request
 * payload (OTLP spans, webhook JSON). Off by default: unlike the 60s metric push
 * this is one outbound request per proxied request.
 */
function TraceExportFields({ form, onChange }: {
  form: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const traces = form.traces as IntegrationTraces | undefined;
  const enabled = traces?.enabled === true;
  const rate = traces?.sampleRate;

  return (
    <div className="form-group">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} style={{ accentColor: 'var(--primary)' }}
          onChange={e => onChange({ traces: { enabled: e.target.checked, ...(rate != null ? { sampleRate: rate } : {}) } })} />
        <span className="form-label" style={{ margin: 0 }}>Export request traces</span>
      </label>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
        Ships the full trace of each proxied request: every phase, every module that
        spoke, and prompts and answers for the projects that opted in.
      </p>
      {enabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <label className="form-label" style={{ margin: 0 }}>Sample rate</label>
          <input className="form-input" type="number" min={0} max={1} step={0.05} style={{ width: 100 }}
            value={rate ?? 1}
            onChange={e => {
              // An emptied field reads as "no sampling", the default, not as "export nothing".
              const value = e.target.value === '' ? 1 : Number(e.target.value);
              const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
              onChange({ traces: { enabled: true, sampleRate: clamped } });
            }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>1 exports every request, 0.1 one in ten.</span>
        </div>
      )}
    </div>
  );
}

function IntegrationIcon({ type, size = 14 }: { type: IntegrationType; size?: number }) {
  const Icon: React.ElementType = INTEGRATION_TYPES.find(t => t.type === type)?.Icon ?? Activity;
  return <Icon size={size} />;
}

function integrationFormFields(
  type: IntegrationType,
  form: Record<string, unknown>,
  onChange: (patch: Record<string, unknown>) => void,
): React.ReactNode {
  switch (type) {
    case 'prometheus':
      return (
        <div className="form-group">
          <label className="form-label">Bearer Token <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input className="form-input" type="password"
            placeholder="Leave empty for open access"
            value={(form.authToken as string) ?? ''}
            onChange={e => onChange({ authToken: e.target.value || undefined })} />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Exposes <code>/metrics</code> in Prometheus text format. Set a token to require Bearer auth.
          </p>
        </div>
      );
    case 'otel':
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Collector endpoint</label>
              <input className="form-input" type="url"
                placeholder="http://otel-collector:4318"
                value={(form.endpoint as string) ?? ''}
                onChange={e => onChange({ endpoint: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Base URL of your OTLP receiver. Routerly appends <code>/v1/metrics</code>, and <code>/v1/traces</code> when trace export is on. Default HTTP port is 4318, gRPC is 4317.
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Protocol</label>
              <SearchableSelect
                options={[{ value: 'http', label: 'HTTP' }, { value: 'grpc', label: 'gRPC' }]}
                value={(form.protocol as string) ?? 'http'}
                onChange={v => onChange({ protocol: v })}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Headers <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional, one per line: Key: Value)</span></label>
            <textarea className="form-input" rows={3}
              placeholder={'Authorization: Bearer token\nX-Custom: value'}
              value={headersToText(form.headers as Record<string, string> | undefined)}
              onChange={e => onChange({ headers: Object.keys(textToHeaders(e.target.value)).length ? textToHeaders(e.target.value) : undefined })}
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }} />
          </div>
          <TraceExportFields form={form} onChange={onChange} />
        </>
      );
    case 'datadog':
      return (
        <>
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input className="form-input" type="password"
              placeholder="Your Datadog API key"
              value={(form.apiKey as string) ?? ''}
              onChange={e => onChange({ apiKey: e.target.value })}
              required />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Found under <strong>Organization Settings → API Keys</strong> in your Datadog account.
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Site</label>
            <SearchableSelect
              options={[
                { value: 'datadoghq.com', label: 'datadoghq.com - US1' },
                { value: 'us3.datadoghq.com', label: 'us3.datadoghq.com - US3' },
                { value: 'us5.datadoghq.com', label: 'us5.datadoghq.com - US5' },
                { value: 'datadoghq.eu', label: 'datadoghq.eu - EU' },
                { value: 'ddog-gov.com', label: 'ddog-gov.com - US1-FED' },
              ]}
              value={(form.site as string) ?? 'datadoghq.com'}
              onChange={v => onChange({ site: v })}
            />
          </div>
        </>
      );
    case 'grafana':
      return (
        <>
          <div className="form-group">
            <label className="form-label">Remote Write URL</label>
            <input className="form-input" type="url"
              placeholder="https://prometheus-prod-01.grafana.net/api/prom/push"
              value={(form.url as string) ?? ''}
              onChange={e => onChange({ url: e.target.value })}
              required />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Found in <strong>Grafana Cloud → Connections → Prometheus → Details</strong> as "Remote Write Endpoint".
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Username / Stack ID</label>
              <input className="form-input"
                placeholder="123456"
                value={(form.username as string) ?? ''}
                onChange={e => onChange({ username: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Numeric ID shown in the Prometheus connection details.
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">API Key / Token</label>
              <input className="form-input" type="password"
                placeholder="glc_eyJ..."
                value={(form.apiKey as string) ?? ''}
                onChange={e => onChange({ apiKey: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Grafana Cloud token with <strong>MetricsPublisher</strong> role.
              </p>
            </div>
          </div>
        </>
      );
    case 'influxdb':
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">URL</label>
              <input className="form-input" type="url"
                placeholder="http://localhost:8086"
                value={(form.url as string) ?? ''}
                onChange={e => onChange({ url: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                InfluxDB v2 instance URL. Cloud: <code>https://us-east-1-1.aws.cloud2.influxdata.com</code>
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Token</label>
              <input className="form-input" type="password"
                placeholder="Your InfluxDB API token"
                value={(form.token as string) ?? ''}
                onChange={e => onChange({ token: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Must have <strong>write</strong> access to the bucket.
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Organization</label>
              <input className="form-input"
                placeholder="my-org"
                value={(form.org as string) ?? ''}
                onChange={e => onChange({ org: e.target.value })}
                required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Bucket</label>
              <input className="form-input"
                placeholder="metrics"
                value={(form.bucket as string) ?? ''}
                onChange={e => onChange({ bucket: e.target.value })}
                required />
            </div>
          </div>
        </>
      );
    case 'webhook':
      return (
        <>
          <div className="form-group">
            <label className="form-label">URL</label>
            <input className="form-input" type="url"
              placeholder="https://example.com/metrics-webhook"
              value={(form.url as string) ?? ''}
              onChange={e => onChange({ url: e.target.value })}
              required />
          </div>
          <div className="form-group">
            <label className="form-label">Secret <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — HMAC-SHA256 signing key)</span></label>
            <input className="form-input" type="password"
              value={(form.secret as string) ?? ''}
              onChange={e => onChange({ secret: e.target.value || undefined })} />
          </div>
          <div className="form-group">
            <label className="form-label">Headers <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional, one per line: Key: Value)</span></label>
            <textarea className="form-input" rows={3}
              placeholder={'Authorization: Bearer token\nX-Custom: value'}
              value={headersToText(form.headers as Record<string, string> | undefined)}
              onChange={e => onChange({ headers: Object.keys(textToHeaders(e.target.value)).length ? textToHeaders(e.target.value) : undefined })}
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }} />
          </div>
          <TraceExportFields form={form} onChange={onChange} />
        </>
      );
  }
}

export function SettingsIntegrationsTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [addOpen, setAddOpen]           = useState(false);
  const [collapsed, setCollapsed]       = useState<Record<string, boolean>>({});
  const [forms, setForms]               = useState<Record<string, Record<string, unknown>>>({});
  const [saving, setSaving]             = useState<Record<string, boolean>>({});
  const [testResults, setTestResults]   = useState<Record<string, { ok: boolean; message: string } | 'testing'>>({});
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getIntegrations()
      .then(setIntegrations)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load integrations'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function handleAdd(type: IntegrationType) {
    setAddOpen(false);
    const id = `draft_${Date.now()}`;
    const defaults: Record<IntegrationType, Record<string, unknown>> = {
      prometheus: { type: 'prometheus', enabled: true },
      otel:       { type: 'otel',       enabled: true, endpoint: '', protocol: 'http' },
      datadog:    { type: 'datadog',    enabled: true, apiKey: '', site: 'datadoghq.com' },
      grafana:    { type: 'grafana',    enabled: true, url: '', username: '', apiKey: '' },
      influxdb:   { type: 'influxdb',   enabled: true, url: '', token: '', org: '', bucket: '' },
      webhook:    { type: 'webhook',    enabled: true, url: '' },
    };
    const draft = { id, ...defaults[type] } as Integration;
    setIntegrations(prev => [...prev, draft]);
    setForms(f => ({ ...f, [id]: { ...draft } }));
    setCollapsed(c => ({ ...c, [id]: false }));
  }

  async function handleToggleEnabled(integration: Integration) {
    try {
      const updated = await updateIntegration(integration.id, { enabled: !integration.enabled });
      setIntegrations(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update integration');
    }
  }

  async function handleSave(id: string) {
    setSaving(s => ({ ...s, [id]: true }));
    try {
      /* v8 ignore next */
      const data = forms[id] ?? {};
      if (id.startsWith('draft_')) {
        const created = await createIntegration(data);
        setIntegrations(prev => prev.map(i => i.id === id ? created : i));
        setForms(f => { const n = { ...f }; delete n[id]; return n; });
        setCollapsed(c => { const n = { ...c }; delete n[id]; n[created.id] = true; return n; });
      } else {
        const updated = await updateIntegration(id, data);
        setIntegrations(prev => prev.map(i => i.id === updated.id ? updated : i));
        setCollapsed(c => ({ ...c, [id]: true }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save integration');
    } finally {
      setSaving(s => ({ ...s, [id]: false }));
    }
  }

  function handleCancel(id: string) {
    if (id.startsWith('draft_')) {
      setIntegrations(prev => prev.filter(i => i.id !== id));
      setForms(f => { const n = { ...f }; delete n[id]; return n; });
    } else {
      setCollapsed(c => ({ ...c, [id]: true }));
    }
  }

  async function handleTest(id: string) {
    setTestResults(r => ({ ...r, [id]: 'testing' }));
    try {
      const result = await testIntegration(id);
      setTestResults(r => ({ ...r, [id]: result }));
    } catch (e) {
      setTestResults(r => ({ ...r, [id]: { ok: false, message: e instanceof Error ? e.message : String(e) } }));
    }
  }

  async function handleDelete(id: string) {
    setPendingDelete(null);
    if (id.startsWith('draft_')) {
      setIntegrations(prev => prev.filter(i => i.id !== id));
      setForms(f => { const n = { ...f }; delete n[id]; return n; });
      return;
    }
    try {
      await deleteIntegration(id);
      setIntegrations(prev => prev.filter(i => i.id !== id));
      setForms(f => { const n = { ...f }; delete n[id]; return n; });
      setTestResults(r => { const n = { ...r }; delete n[id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete integration');
    }
  }

  function patchForm(id: string, patch: Record<string, unknown>) {
    /* v8 ignore next */
    setForms(f => ({ ...f, [id]: { ...(f[id] ?? {}), ...patch } }));
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  const cardHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
  };

  return (
    <div style={{ maxWidth: 600 }}>
      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {integrations.length === 0 && (
        <div style={{ padding: '40px 0 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No integrations configured yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: integrations.length > 0 ? 16 : 0 }}>
        {integrations.map(integration => {
          const meta = INTEGRATION_TYPES.find(t => t.type === integration.type);
          const isEditing = collapsed[integration.id] === false;
          const form = forms[integration.id] ?? { ...integration };
          const testResult = testResults[integration.id];
          const isSaving = saving[integration.id] ?? false;

          return (
            <div key={integration.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {/* Card header */}
              <div style={cardHeaderStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <button type="button"
                    onClick={() => {
                      if (!isEditing) setForms(f => ({ ...f, [integration.id]: { ...integration } }));
                      setCollapsed(c => ({ ...c, [integration.id]: isEditing }));
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', flexShrink: 0 }}>
                    {isEditing ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <span style={{ color: 'var(--accent)', flexShrink: 0, display: 'flex' }}>
                    <IntegrationIcon type={integration.type} size={14} />
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{meta?.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {integration.id}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {/* Enabled toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <input type="checkbox" checked={integration.enabled}
                      onChange={() => handleToggleEnabled(integration)}
                      style={{ width: 14, height: 14, cursor: 'pointer' }} />
                    Enabled
                  </label>
                  {/* Test button */}
                  <button type="button" className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}
                    disabled={testResult === 'testing'}
                    onClick={() => handleTest(integration.id)}>
                    {testResult === 'testing'
                      ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Testing…</>
                      : 'Test'}
                  </button>
                  {/* Delete */}
                  {pendingDelete === integration.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Remove?</span>
                      <button type="button" onClick={() => handleDelete(integration.id)}
                        style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.1)', color: 'rgb(239,68,68)', cursor: 'pointer' }}>
                        Remove
                      </button>
                      <button type="button" onClick={() => setPendingDelete(null)}
                        style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setPendingDelete(integration.id)} title="Remove integration"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Test result inline badge */}
              {testResult && testResult !== 'testing' && (
                <div style={{
                  padding: '6px 14px', fontSize: '0.8rem',
                  background: testResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  borderBottom: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  color: testResult.ok ? '#22c55e' : '#ef4444',
                }}>
                  {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
                </div>
              )}

              {/* Expanded form */}
              {isEditing && (
                <div style={{ padding: 16 }}>
                  {integrationFormFields(integration.type, form, patch => patchForm(integration.id, patch))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button type="button" className="btn btn-primary" disabled={isSaving}
                      style={{ fontSize: '0.83rem' }}
                      onClick={() => handleSave(integration.id)}>
                      {isSaving ? <><div className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : <><Save size={13} /> Save</>}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={isSaving}
                      style={{ fontSize: '0.83rem' }}
                      onClick={() => handleCancel(integration.id)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add integration dropdown */}
      <div ref={addRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button type="button" className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setAddOpen(o => !o)}>
          <Plus size={14} /> Add Integration
        </button>
        {addOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: 260, zIndex: 100, overflow: 'hidden',
          }}>
            {INTEGRATION_TYPES.map((t, i) => (
              <button key={t.type} type="button" onClick={() => handleAdd(t.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '10px 14px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                  borderBottom: i < INTEGRATION_TYPES.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                <t.Icon size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Catalog tab ──────────────────────────────────────────────────────────────

const DEFAULT_REPO_URL = 'https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/';

export function SettingsCatalogTab() {
  const [repos, setRepos] = useState<ProviderRepo[]>([]);
  const [status, setStatus] = useState<RepoStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [probing, setProbing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editError, setEditError] = useState('');
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      getSettings(),
      getCatalogStatus().catch(() => [] as RepoStatus[]),
    ])
      .then(([s, st]) => {
        setRepos(s.providerRepos ?? [{ url: DEFAULT_REPO_URL, enabled: true }]);
        setStatus(st);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  async function persist(updated: ProviderRepo[], doRefresh = false) {
    setRepos(updated);
    await updateSettings({ providerRepos: updated } as Partial<Settings>);
    if (doRefresh) {
      const st = await refreshCatalog().catch(() => [] as RepoStatus[]);
      setStatus(st);
    }
    setSaved('Saved.');
    setTimeout(() => setSaved(''), 2000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    setAddError('');
    if (repos.some(r => r.url === url)) {
      setAddError('This URL is already in the list.');
      return;
    }
    setProbing(true);
    try {
      const probe = await probeRepo(url);
      if (!probe.ok) {
        setAddError(probe.error ?? 'Could not reach a valid provider catalog at this URL.');
        return;
      }
    } catch {
      setAddError('Could not reach a valid provider catalog at this URL.');
      return;
    } finally {
      setProbing(false);
    }
    await persist([...repos, { url, enabled: true }], true);
    setNewUrl('');
  }

  function startEdit(idx: number) {
    const repo = repos[idx];
    /* v8 ignore next */
    if (!repo) return;
    setEditIdx(idx);
    setEditUrl(repo.url);
    setEditEnabled(repo.enabled);
    setEditError('');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    /* v8 ignore next */
    if (editIdx === null) return;
    const url = editUrl.trim();
    setEditError('');
    if (repos.some((r, i) => i !== editIdx && r.url === url)) {
      setEditError('This URL is already in the list.');
      return;
    }
    /* v8 ignore next */
    const urlChanged = url !== repos[editIdx]?.url;
    await persist(repos.map((r, i) => i === editIdx ? { ...r, url, enabled: editEnabled } : r), urlChanged);
    setEditIdx(null);
  }

  async function confirmRemove(idx: number) {
    /* v8 ignore next */
    if (editIdx === idx) setEditIdx(null);
    await persist(repos.filter((_, i) => i !== idx));
    setConfirmRemoveIdx(null);
  }

  async function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    /* v8 ignore next */
    if (next < 0 || next >= repos.length) return;
    const updated = [...repos];
    [updated[idx], updated[next]] = [updated[next]!, updated[idx]!];
    await persist(updated);
    /* v8 ignore next 2 */
    if (editIdx === idx) setEditIdx(next);
    else if (editIdx === next) setEditIdx(idx);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const st = await refreshCatalog().catch(() => [] as RepoStatus[]);
      setStatus(st);
      setSaved('Refreshed.');
      setTimeout(() => setSaved(''), 2000);
    } finally {
      setRefreshing(false);
    }
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /* v8 ignore start */
  function fileLabel(f: string | null) {
    if (!f) return '—';
    const m = f.match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.json$/);
    if (m) {
      const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
      return dt.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    }
    const parts = f.split('/');
    return parts[parts.length - 1] ?? f;
  }
  /* v8 ignore stop */

  const latestChecked = status.reduce<string | null>((max, s) =>
    s.lastChecked && (!max || s.lastChecked > max) ? s.lastChecked : max, null);
  const nextRefreshLabel = latestChecked
    ? new Date(new Date(latestChecked).getTime() + 6 * 60 * 60 * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const COL = '40px 1fr 130px 130px 72px 90px';

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div>
      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: 0 }}>
          Provider Catalog Repositories
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <button type="button" className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 5 }}
            disabled={refreshing}
            onClick={() => void handleRefresh()}>
            {refreshing ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Refreshing…</> : 'Refresh'}
          </button>
          {nextRefreshLabel && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Next: {nextRefreshLabel}</span>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
        Row order determines merge priority — row 1 wins on conflict. Use the arrows to reorder.
      </p>

      {saved && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.85rem', color: '#22c55e' }}>
          {saved}
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 0, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', padding: '6px 14px' }}>
          {['#', 'URL', 'Updated', 'Last Check', 'Status', ''].map(h => (
            <span key={h} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
          ))}
        </div>

        {repos.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No repositories configured. The default Routerly public catalog will be used.
          </div>
        )}

        {repos.map((repo, idx) => {
          const st = status.find(s => s.url === repo.url);
          return (
            <div key={idx} style={{ borderBottom: idx < repos.length - 1 ? '1px solid var(--border)' : 'none' }}>
              {editIdx === idx ? (
                <form onSubmit={e => void handleSaveEdit(e)} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-elevated)' }}>
                  <div>
                    <label className="form-label" htmlFor={`edit-url-${idx}`}>URL</label>
                    <input id={`edit-url-${idx}`} className="form-input" type="url" value={editUrl}
                      onChange={e => { setEditUrl(e.target.value); setEditError(''); }} required autoFocus />
                    {editError && <div className="form-error" style={{ marginTop: 4 }}>{editError}</div>}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={editEnabled} onChange={e => setEditEnabled(e.target.checked)} />
                    Enabled
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '4px 14px' }}>Save</button>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 14px' }} onClick={() => setEditIdx(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: COL, alignItems: 'center', padding: '8px 14px', gap: 0 }}>
                  {/* Priority + arrows */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                    <button type="button" onClick={() => void move(idx, -1)} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--border)' : 'var(--text-muted)', padding: '1px 4px', display: 'flex' }}>
                      <ChevronUp size={12} />
                    </button>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1 }}>{idx + 1}</span>
                    <button type="button" onClick={() => void move(idx, 1)} disabled={idx === repos.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === repos.length - 1 ? 'default' : 'pointer', color: idx === repos.length - 1 ? 'var(--border)' : 'var(--text-muted)', padding: '1px 4px', display: 'flex' }}>
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  {/* URL */}
                  <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }} title={repo.url}>{repo.url}</span>
                  {/* Updated at */}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(st?.updatedAt ?? null)}</span>
                  {/* Last checked */}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(st?.lastChecked ?? null)}</span>
                  {/* Status */}
                  <span style={{ fontSize: '0.75rem', color: st?.error ? '#ef4444' : repo.enabled ? '#22c55e' : 'var(--text-muted)' }}
                    title={st?.error ?? ''}>
                    {st?.error ? 'Error' : repo.enabled ? 'Active' : 'Disabled'}
                  </span>
                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '2px 8px' }} onClick={() => startEdit(idx)}>Edit</button>
                    <button type="button" onClick={() => setConfirmRemoveIdx(idx)} title="Remove"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={e => void handleAdd(e)} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: 600 }}>
        <div style={{ flex: 1 }}>
          <label className="form-label" htmlFor="catalog-url">Add Repository</label>
          <input id="catalog-url" className="form-input" type="url" placeholder="https://example.com/catalog/"
            value={newUrl} onChange={e => { setNewUrl(e.target.value); setAddError(''); }} required />
          {addError && <div className="form-error" style={{ marginTop: 4 }}>{addError}</div>}
        </div>
        <button type="submit" className="btn btn-primary" style={{ fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 5 }} disabled={probing}>
          {probing ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Checking…</> : <><Plus size={14} /> Add</>}
        </button>
      </form>

      {confirmRemoveIdx !== null && (
        <ConfirmDialog
          message={`Remove repository "${repos[confirmRemoveIdx]?.url}"?`}
          onConfirm={() => void confirmRemove(confirmRemoveIdx)}
          onCancel={() => setConfirmRemoveIdx(null)}
          confirmLabel="Remove"
          danger={true}
        />
      )}
    </div>
  );
}

// ── About tab ────────────────────────────────────────────────────────────────

const FALLBACK_RELEASES: AvailableReleases = { channels: ['latest', 'stable', 'develop'], versions: [] };
const CHANNEL_LABELS: Record<string, string> = { stable: 'current', latest: 'latest', develop: 'develop' };

function ChannelSelector({
  current,
  onSave,
}: {
  current: string;
  onSave: (ch: string) => Promise<void>;
}) {
  const [releases, setReleases] = React.useState<AvailableReleases>(FALLBACK_RELEASES);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [customVal, setCustomVal] = React.useState('');
  const [showCustom, setShowCustom] = React.useState(false);

  React.useEffect(() => {
    getAvailableReleases().then(setReleases).catch(() => setReleases(FALLBACK_RELEASES));
  }, []);

  const knownValues = [...releases.channels, ...releases.versions];
  const isKnown = knownValues.includes(current);

  React.useEffect(() => {
    if (!isKnown) { setShowCustom(true); setCustomVal(current); }
  }, [current, isKnown]);

  async function save(ch: string) {
    if (!ch.trim()) return;
    setSaving(true); setSaved(false); setErr('');
    try {
      await onSave(ch.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleSelectChange(v: string) {
    if (v === '__custom') { setShowCustom(true); return; }
    void save(v);
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)', flexShrink: 0, marginRight: 20 }}>Channel</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {err && <span style={{ fontSize: '0.72rem', color: 'var(--error, #e53e3e)' }}>{err}</span>}
        {saved && <span style={{ fontSize: '0.72rem', color: '#22c55e' }}>Saved</span>}
        {saving && <div className="spinner" style={{ width: 12, height: 12 }} />}
        {showCustom ? (
          <>
            <input
              className="form-input"
              style={{ width: 100, fontSize: '0.78rem', padding: '3px 8px', margin: 0 }}
              placeholder="v0.2.0"
              value={customVal}
              onChange={e => setCustomVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save(customVal); }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '3px 10px' }}
              disabled={saving || !customVal.trim()}
              onClick={() => void save(customVal)}
            >Apply</button>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
              onClick={() => setShowCustom(false)}
            >← back</button>
          </>
        ) : (
          <SearchableSelect
            style={{ fontSize: '0.83rem', width: 130 }}
            value={isKnown ? current : '__custom'}
            onChange={handleSelectChange}
            disabled={saving}
            options={[
              ...releases.channels.map(ch => ({ value: ch, label: CHANNEL_LABELS[ch] ?? ch })),
              { value: '__custom', label: 'custom...' },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)', flexShrink: 0, marginRight: 20 }}>{label}</span>
      <span style={{ fontSize: mono ? '0.78rem' : '0.83rem', color: 'var(--text-primary)', fontFamily: mono ? 'monospace' : undefined, textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

export function SettingsAboutTab() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Update-check state
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const [updateError, setUpdateError] = useState('');
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    getSystemInfo()
      .then(i => { setInfo(i); setUpdateInfo(i.updateInfo); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleChannelSave(ch: string) {
    await updateSettings({ channel: ch });
    /* v8 ignore next */
    setInfo(prev => prev ? { ...prev, channel: ch } : prev);
  }

  async function handleCheckUpdates() {
    setChecking(true);
    setUpdateError('');
    try {
      const result = await checkForUpdates();
      setUpdateInfo(result);
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setChecking(false);
    }
  }

  function handleUpdate() {
    setConfirmState({
      message: 'This will download and install the latest version. The service will restart. Continue?',
      onConfirm: () => { setConfirmState(null); doUpdate(); },
    });
  }

  async function doUpdate() {
    setUpdating(true);
    setUpdateError('');
    setUpdateMsg('');
    try {
      const result = await triggerUpdate();
      setUpdateMsg(result.message);
      // Poll /health every 3s for up to 60s waiting for the service to come back
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch('/health');
          if (r.ok) {
            clearInterval(pollRef.current!);
            setUpdateMsg('Update complete! Reloading…');
            setTimeout(() => window.location.reload(), 1500);
          }
        } catch { /* still restarting */ }
        if (attempts >= 20) {
          clearInterval(pollRef.current!);
          setUpdating(false);
          setUpdateMsg('Service is restarting. Please reload the page in a moment.');
        }
      }, 3000);
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Update failed');
      setUpdating(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;
  if (error) return <div className="form-error">{error}</div>;
  /* v8 ignore next */
  if (!info) return null;

  const isAdmin = info.isDocker === false; // will refine via App.tsx context if needed
  void isAdmin;

  return (
    <>
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Application</h3>
        <InfoRow label="Version" value={`v${info.version}`} />
        <ChannelSelector current={info.channel ?? 'latest'} onSave={handleChannelSave} />
        <InfoRow label="Uptime" value={formatUptime(info.uptimeSeconds)} />
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Runtime</h3>
        <InfoRow label="Node.js" value={info.nodeVersion} />
        <InfoRow label="Platform" value={info.platform} />
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Storage</h3>
        <InfoRow label="Config directory" value={info.configDir} mono />
        <InfoRow label="Data directory" value={info.dataDir} mono />
      </div>

      <div>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Software Update</h3>
        {updateInfo ? (
          <>
            <InfoRow label="Current version" value={`v${updateInfo.currentVersion}`} />
            <InfoRow label="Available version" value={updateInfo.available ? `v${updateInfo.latestVersion}` : 'Up to date'} />
            {updateInfo.checkedAt && (
              <InfoRow label="Last checked" value={new Date(updateInfo.checkedAt).toLocaleString()} />
            )}
          </>
        ) : (
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', padding: '9px 0' }}>No update check performed yet.</p>
        )}
        {updateError && <p style={{ color: 'var(--error, #e53e3e)', fontSize: '0.83rem', margin: '8px 0 0' }}>{updateError}</p>}
        {updateMsg && <p style={{ color: 'var(--accent)', fontSize: '0.83rem', margin: '8px 0 0' }}>{updateMsg}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-secondary"
            onClick={handleCheckUpdates}
            disabled={checking || updating}
            style={{ fontSize: '0.83rem' }}
          >
            {checking ? <><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />Checking…</> : 'Check for updates'}
          </button>
          {!info.isDocker && updateInfo?.available && (
            <button
              className="btn btn-primary"
              onClick={handleUpdate}
              disabled={updating}
              style={{ fontSize: '0.83rem' }}
            >
              {updating ? <><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />Updating…</> : `Update to v${updateInfo.latestVersion}`}
            </button>
          )}
          {info.isDocker && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', alignSelf: 'center', margin: 0 }}>
              Running in Docker — pull the latest image to update.
            </p>
          )}
        </div>
      </div>
    </div>
    {confirmState && (
      <ConfirmDialog
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(null)}
        danger={false}
      />
    )}
    </>
  );
}

// ── Security tab ─────────────────────────────────────────────────────────────

export function SettingsSecurityTab() {
  const [requireMfa, setRequireMfa] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings()
      .then(s => setRequireMfa(!!s.requireMfa))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings({ requireMfa });
      setSaved(true);
      setTimeout(/* v8 ignore next */ () => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={13} /> Authentication
        </h3>

        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requireMfa}
              onChange={e => setRequireMfa(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            Require Two-Factor Authentication for all users
          </label>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            When enabled, users who have not set up 2FA will see a prompt to do so after logging in.
            Users can configure 2FA in their Profile page.
          </p>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {saved && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.85rem', color: '#22c55e' }}>
          Settings saved successfully.
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : <><Save size={15} /> Save Settings</>}
        </button>
      </div>
    </form>
  );
}

// ── Page layout ───────────────────────────────────────────────────────────────

const TABS = [
  { path: 'general',       label: 'General' },
  { path: 'security',      label: 'Security' },
  { path: 'notifications', label: 'Notifications' },
  { path: 'integrations',  label: 'Integrations' },
  { path: 'catalog',       label: 'Provider Catalog' },
  { path: 'users',         label: 'Users' },
  { path: 'roles',         label: 'Roles' },
  { path: 'audit',         label: 'Audit Log' },
  { path: 'about',         label: 'About' },
];

export function SettingsPage() {
  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>Settings</h1>
        <p>Configuration for Routerly</p>

        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginTop: 16 }}>
          {TABS.map(t => (
            <NavLink
              key={t.path}
              to={t.path}
              style={({ isActive }) => ({
                padding: '0 4px 12px',
                display: 'flex',
                alignItems: 'center',
                fontSize: '0.9rem',
                fontWeight: 500,
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                textDecoration: 'none',
                transition: 'all 0.2s',
                marginBottom: -1,
              })}
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 32 }}>
        <Outlet />
      </div>
    </>
  );
}
