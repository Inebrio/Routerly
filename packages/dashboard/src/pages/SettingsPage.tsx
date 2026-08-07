import React, { useEffect, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Save, Plus, Trash2, Mail, Search, ChevronDown, ChevronRight, ChevronUp, Globe, BarChart2, Bell, Users, GitBranch, Activity, TrendingUp, Database, Webhook, Dog, Copy, Check, Shield } from 'lucide-react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { getSettings, updateSettings, getSystemInfo, testNotificationChannel, checkForUpdates, triggerUpdate, getAvailableReleases, getRoles, getUsers, ALL_PERMISSIONS, getIntegrations, createIntegration, updateIntegration, deleteIntegration, testIntegration, refreshCatalog, getCatalogStatus, probeRepo } from '../api';
import type { Settings, SystemInfo, UpdateInfo, AvailableReleases, Role, User, Permission, Integration, IntegrationTraces, IntegrationType, ProviderRepo, RepoStatus, UsageRetentionConfig } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MultiSelect } from '../components/MultiSelect';
import { SearchableSelect } from '../components/SearchableSelect';
import { writeToClipboard } from '../utils/clipboard';
import { isCaptureMode } from '../utils/captureMode';
import { NOTIFICATION_EVENTS, normalizeUpdateChannel } from '@routerly/shared';

const LOG_LEVELS: Settings['logLevel'][] = ['trace', 'debug', 'info', 'warn', 'error'];

// ── Telemetry section (self-saving) ──────────────────────────────────────────

function TelemetrySection({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const { t } = useTranslation();
  const telemetry = settings.telemetry;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function toggle(enabled: boolean) {
    setSaving(true);
    setError('');
    try {
      const updated = await updateSettings({ telemetry: { enabled } } as Partial<Settings>);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.general.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <BarChart2 size={13} /> {t('settings.general.telemetry.heading')}
      </h3>

      <div style={{ padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
        <p style={{ fontSize: '0.83rem', color: 'var(--text-primary)', margin: '0 0 4px' }}>
          <strong>{t('settings.general.telemetry.neverAutomatic')}</strong>{' '}
          {telemetry === undefined
            ? t('settings.general.telemetry.noChoice')
            : telemetry.enabled
              ? t('settings.general.telemetry.enabledStatus')
              : t('settings.general.telemetry.disabledStatus')}
        </p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('settings.general.telemetry.explanation')}{' '}
          <a href="https://doc.routerly.ai/next/reference/telemetry" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            {t('settings.general.telemetry.whatIsSent')}
          </a>
        </p>

        {telemetry?.enabled && telemetry.installId && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 12px', fontFamily: 'monospace' }}>
            {t('settings.general.telemetry.installId', { id: telemetry.installId })}
          </p>
        )}

        {error && <p style={{ fontSize: '0.78rem', color: 'var(--error, #e53e3e)', margin: '0 0 10px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className={`btn btn-sm ${telemetry?.enabled ? 'btn-primary' : 'btn-secondary'}`}
            disabled={saving || telemetry?.enabled === true}
            onClick={() => toggle(true)}
            style={{ fontSize: '0.8rem' }}
          >
            {saving && !telemetry?.enabled ? <><div className="spinner" style={{ width: 11, height: 11 }} /> {t('settings.general.telemetry.saving')}</> : t('settings.general.telemetry.enable')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${telemetry?.enabled === false ? 'btn-primary' : 'btn-secondary'}`}
            disabled={saving || telemetry?.enabled === false}
            onClick={() => toggle(false)}
            style={{ fontSize: '0.8rem' }}
          >
            {saving && telemetry?.enabled ? <><div className="spinner" style={{ width: 11, height: 11 }} /> {t('settings.general.telemetry.saving')}</> : t('settings.general.telemetry.disable')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────

/** Which addresses only work on this machine, so the list says it instead of implying it. */
function addressScope(address: string, t: (k: string) => string): string {
  return /\/\/(127\.|\[?::1\]?|localhost)/.test(address) ? t('settings.general.serverInfo.thisMachine') : t('settings.general.serverInfo.network');
}


export function SettingsGeneralTab() {
  const { t } = useTranslation();
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
      setForm({ logLevel: s.logLevel, publicUrl: s.publicUrl || `http://localhost:${s.port}`, usageRetention: s.usageRetention ?? {}, ...(s.notifications ? { notifications: s.notifications } : {}) });
      // Version and uptime live on /api/system/info; a failure there must not hide the settings form.
      getSystemInfo().then(setInfo).catch(() => setInfo(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.general.errors.loadFailed'));
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
      setError(e instanceof Error ? e.message : t('settings.general.errors.saveSettingsFailed'));
    } finally {
      setSaving(false);
    }
  }

  function field<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f: Partial<Settings>) => ({ ...f, [key]: value }));
  }

  /** Empty input clears that sub-field (omits it from `usageRetention`); a valid number sets it. */
  function retentionField(key: keyof UsageRetentionConfig, raw: string) {
    const value = raw === '' ? undefined : Number(raw);
    setForm((f: Partial<Settings>) => {
      const next = { ...f.usageRetention };
      if (value === undefined || Number.isNaN(value)) delete next[key];
      else next[key] = value;
      return { ...f, usageRetention: next };
    });
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;
  /* v8 ignore next */
  if (!settings) return <div className="form-error" style={{ margin: 24 }}>{error || t('settings.general.errors.loadFailedPeriod')}</div>;

  // Older services do not report the resolved interfaces: fall back to the bind address.
  const listenAddresses = settings.listeningAddresses?.length
    ? settings.listeningAddresses
    : [`http://${settings.host}:${settings.port}`];

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
          {t('settings.general.serverInfo.heading')}
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('settings.general.serverInfo.readOnly')}
        </p>

        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          {listenAddresses.length === 1 ? t('settings.general.serverInfo.reachableAt') : t('settings.general.serverInfo.reachableAtAny')}
        </div>
        {listenAddresses.map(address => (
          <div key={address} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-input, var(--bg-tertiary, var(--bg-secondary)))', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', minWidth: 0 }}>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {address}
              </span>
              <span className="badge badge-neutral" style={{ flexShrink: 0 }}>{addressScope(address, t)}</span>
            </div>
            <button
              type="button"
              onClick={() => copyAddress(address)}
              className="btn btn-secondary"
              aria-label={t('settings.general.serverInfo.copyAddress', { address })}
              style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {copied === address ? <Check size={13} /> : <Copy size={13} />}
              {copied === address ? t('settings.general.serverInfo.copied') : t('settings.general.serverInfo.copy')}
            </button>
          </div>
        ))}

        <div style={{ marginTop: 14 }}>
          <InfoRow label={t('settings.general.serverInfo.hostAndPort')} value={`${settings.host}:${settings.port}`} mono />
          {info && <InfoRow label={t('settings.general.serverInfo.version')} value={info.version} mono />}
          {info && <InfoRow label={t('settings.general.serverInfo.uptime')} value={formatUptime(info.uptimeSeconds)} />}
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
          {t('settings.general.runtime.heading')}
        </h3>

        <div className="form-group">
          <label className="form-label">{t('settings.general.runtime.logLevel')}</label>
          <SearchableSelect
            options={LOG_LEVELS.map(l => ({ value: l, label: l }))}
            value={form.logLevel ?? 'info'}
            placeholder={t('settings.general.runtime.logLevel')}
            ariaLabel={t('settings.general.runtime.logLevel')}
            onChange={v => field('logLevel', v as Settings['logLevel'])}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {t('settings.general.runtime.logLevelHint')}
          </p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="s-publicurl">{t('settings.general.runtime.publicUrl')}</label>
          <input
            id="s-publicurl"
            className="form-input"
            type="url"
            placeholder={`http://${settings?.host === '0.0.0.0' ? '<your-ip>' : (settings?.host ?? 'localhost')}:${settings?.port ?? 3000}`}
            value={form.publicUrl ?? ''}
            onChange={e => field('publicUrl', e.target.value)}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            <Trans
              i18nKey="settings.general.runtime.publicUrlHint"
              components={{ code: <code />, strong: <strong /> }}
            />
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.general.runtime.usageRetention')}</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              id="s-usage-retention-days"
              className="form-input"
              type="number"
              min={1}
              placeholder={t('settings.general.runtime.noLimit')}
              aria-label={t('settings.general.runtime.maxAgeDays')}
              value={form.usageRetention?.maxAgeDays ?? ''}
              onChange={e => retentionField('maxAgeDays', e.target.value)}
            />
            <input
              id="s-usage-retention-size"
              className="form-input"
              type="number"
              min={1}
              placeholder={t('settings.general.runtime.noLimit')}
              aria-label={t('settings.general.runtime.maxSizeMb')}
              value={form.usageRetention?.maxSizeMb ?? ''}
              onChange={e => retentionField('maxSizeMb', e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <p style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{t('settings.general.runtime.maxAgeDays')}</p>
            <p style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{t('settings.general.runtime.maxSizeMb')}</p>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {t('settings.general.runtime.retentionHint')}
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
          {t('settings.general.savedSuccess')}
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> {t('settings.general.saving')}</> : <><Save size={15} /> {t('settings.general.saveSettings')}</>}
        </button>
      </div>

    </form>
  );
}

// ── Notifications tab ────────────────────────────────────────────────────────

type NotifForm = { notifications?: import('../api').NotificationsConfig };
type EProvider = import('../api').ChannelProvider;
type EChannel  = import('../api').NotificationChannel;

function useChannelProviders(t: (k: string) => string): Array<{ key: EProvider; label: string; description: string }> {
  return [
    { key: 'dashboard',  label: t('settings.notifications.providers.dashboard.label'), description: t('settings.notifications.providers.dashboard.description') },
    { key: 'smtp',       label: t('settings.notifications.providers.smtp.label'), description: t('settings.notifications.providers.smtp.description') },
    { key: 'ses',        label: t('settings.notifications.providers.ses.label'), description: t('settings.notifications.providers.ses.description') },
    { key: 'sendgrid',   label: t('settings.notifications.providers.sendgrid.label'), description: t('settings.notifications.providers.sendgrid.description') },
    { key: 'azure',      label: t('settings.notifications.providers.azure.label'), description: t('settings.notifications.providers.azure.description') },
    { key: 'google',     label: t('settings.notifications.providers.google.label'), description: t('settings.notifications.providers.google.description') },
    { key: 'webhook',    label: t('settings.notifications.providers.webhook.label'), description: t('settings.notifications.providers.webhook.description') },
    { key: 'slack',      label: t('settings.notifications.providers.slack.label'), description: t('settings.notifications.providers.slack.description') },
    { key: 'teams',      label: t('settings.notifications.providers.teams.label'), description: t('settings.notifications.providers.teams.description') },
    { key: 'pagerduty',  label: t('settings.notifications.providers.pagerduty.label'), description: t('settings.notifications.providers.pagerduty.description') },
    { key: 'discord',    label: t('settings.notifications.providers.discord.label'), description: t('settings.notifications.providers.discord.description') },
  ];
}

// Readable labels for the canonical events
function useEventLabels(t: (k: string) => string): Record<string, string> {
  return {
    'provider.error':            t('settings.notifications.events.providerError'),
    'provider.degraded':         t('settings.notifications.events.providerDegraded'),
    'provider.recovered':        t('settings.notifications.events.providerRecovered'),
    'provider.rate_limited':     t('settings.notifications.events.providerRateLimited'),
    'routing.no_candidates':     t('settings.notifications.events.routingNoCandidates'),
    'routing.fallback_used':     t('settings.notifications.events.routingFallbackUsed'),
    'auth.login_failed':         t('settings.notifications.events.authLoginFailed'),
    'auth.token_invalid':        t('settings.notifications.events.authTokenInvalid'),
    'config.model_added':        t('settings.notifications.events.configModelAdded'),
    'config.model_deleted':      t('settings.notifications.events.configModelDeleted'),
    'config.router_created':    t('settings.notifications.events.configRouterCreated'),
    'config.router_deleted':    t('settings.notifications.events.configRouterDeleted'),
    'budget.threshold_reached':  t('settings.notifications.events.budgetThresholdReached'),
    'budget.exceeded':           t('settings.notifications.events.budgetExceeded'),
    'budget.reset':              t('settings.notifications.events.budgetReset'),
    'system.startup':            t('settings.notifications.events.systemStartup'),
    'system.shutdown':           t('settings.notifications.events.systemShutdown'),
    'system.update_available':   t('settings.notifications.events.systemUpdateAvailable'),
  };
}

function useEventOptions(t: (k: string) => string) {
  const labels = useEventLabels(t);
  /* v8 ignore next */
  return NOTIFICATION_EVENTS.map(e => ({ value: e, label: labels[e] ?? e }));
}

function usePermLabels(t: (k: string) => string): Record<Permission, string> {
  return {
    'router:read':       t('settings.notifications.perms.routerRead'),
    'router:write':      t('settings.notifications.perms.routerWrite'),
    'model:read':         t('settings.notifications.perms.modelRead'),
    'model:write':        t('settings.notifications.perms.modelWrite'),
    'user:read':          t('settings.notifications.perms.userRead'),
    'user:write':         t('settings.notifications.perms.userWrite'),
    'report:read':        t('settings.notifications.perms.reportRead'),
    'settings:read':      t('settings.notifications.perms.settingsRead'),
    'settings:write':     t('settings.notifications.perms.settingsWrite'),
    'notification:write': t('settings.notifications.perms.notificationWrite'),
    'token:read':         t('settings.notifications.perms.tokenRead'),
    'token:write':        t('settings.notifications.perms.tokenWrite'),
    'role:write':         t('settings.notifications.perms.roleWrite'),
    'audit:read':         t('settings.notifications.perms.auditRead'),
    'modules:read':       t('settings.notifications.perms.modulesRead'),
    'modules:manage':     t('settings.notifications.perms.modulesManage'),
    'connections:read':   t('settings.notifications.perms.connectionsRead'),
    'connections:manage': t('settings.notifications.perms.connectionsManage'),
    'resilience:read':    t('settings.notifications.perms.resilienceRead'),
    'resilience:manage':  t('settings.notifications.perms.resilienceManage'),
    'profiles:read':      t('settings.notifications.perms.profilesRead'),
    'profiles:manage':    t('settings.notifications.perms.profilesManage'),
    'optimizers:read':    t('settings.notifications.perms.optimizersRead'),
    'optimizers:manage':  t('settings.notifications.perms.optimizersManage'),
    'experiments:read':   t('settings.notifications.perms.experimentsRead'),
    'experiments:manage': t('settings.notifications.perms.experimentsManage'),
  };
}

function usePermOptions(t: (k: string) => string) {
  const labels = usePermLabels(t);
  /* v8 ignore next */
  return ALL_PERMISSIONS.map(p => ({ value: p, label: labels[p] ?? p }));
}

/** Fixed-endpoint channels: targets change inbox visibility/email recipients, but don't change the actual delivery destination */
const FIXED_ENDPOINT_PROVIDERS: EProvider[] = ['webhook', 'slack', 'teams', 'pagerduty', 'discord'];

function targetsHint(provider: EProvider, t: (k: string) => string): string | null {
  if (FIXED_ENDPOINT_PROVIDERS.includes(provider)) {
    return t('settings.notifications.targetsHint.fixedEndpoint');
  }
  if (provider === 'dashboard') {
    return t('settings.notifications.targetsHint.dashboard');
  }
  // email providers
  return t('settings.notifications.targetsHint.email');
}

/** Summarise events + targets for collapsed card view */
function summariseChannel(ch: EChannel, t: TFunction): string {
  const parts: string[] = [];
  const evCount = ch.events?.length ?? 0;
  parts.push(evCount === 0 ? t('settings.notifications.summary.allEvents') : t('settings.notifications.summary.eventCount', { count: evCount }));
  const targets = ch.targets;
  const targetParts: string[] = [];
  if (targets?.roles?.length) targetParts.push(t('settings.notifications.summary.roleCount', { count: targets.roles.length }));
  if (targets?.permissions?.length) targetParts.push(t('settings.notifications.summary.permCount', { count: targets.permissions.length }));
  if (targets?.users?.length) targetParts.push(t('settings.notifications.summary.userCount', { count: targets.users.length }));
  parts.push(targetParts.length ? targetParts.join(', ') : t('settings.notifications.summary.everyone'));
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
  const { t } = useTranslation();
  const CHANNEL_PROVIDERS = useChannelProviders(t);
  const EVENT_OPTIONS = useEventOptions(t);
  const PERM_OPTIONS = usePermOptions(t);
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
      .catch(e => setError(e instanceof Error ? e.message : t('settings.notifications.errors.loadFailed')))
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
    const hint = targetsHint(ch.provider, t);

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
                      {summariseChannel(ch, t)}
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

const INTEGRATION_ICONS: Record<IntegrationType, React.ElementType> = {
  prometheus: BarChart2,
  otel: GitBranch,
  datadog: Dog,
  grafana: TrendingUp,
  influxdb: Database,
  webhook: Webhook,
};

function useIntegrationTypes(): Array<{ type: IntegrationType; label: string; description: string; Icon: React.ElementType }> {
  const { t } = useTranslation();
  return (Object.keys(INTEGRATION_ICONS) as IntegrationType[]).map(type => ({
    type,
    label: t(`settings.integrations.types.${type}.label`),
    description: t(`settings.integrations.types.${type}.description`),
    Icon: INTEGRATION_ICONS[type],
  }));
}

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
  const { t } = useTranslation();
  const traces = form.traces as IntegrationTraces | undefined;
  const enabled = traces?.enabled === true;
  const rate = traces?.sampleRate;

  return (
    <div className="form-group">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} style={{ accentColor: 'var(--primary)' }}
          onChange={e => onChange({ traces: { enabled: e.target.checked, ...(rate != null ? { sampleRate: rate } : {}) } })} />
        <span className="form-label" style={{ margin: 0 }}>{t('settings.integrations.traces.label')}</span>
      </label>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
        {t('settings.integrations.traces.description')}
      </p>
      {enabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <label className="form-label" style={{ margin: 0 }}>{t('settings.integrations.traces.sampleRateLabel')}</label>
          <input className="form-input" type="number" min={0} max={1} step={0.05} style={{ width: 100 }}
            value={rate ?? 1}
            onChange={e => {
              // An emptied field reads as "no sampling", the default, not as "export nothing".
              const value = e.target.value === '' ? 1 : Number(e.target.value);
              const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
              onChange({ traces: { enabled: true, sampleRate: clamped } });
            }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('settings.integrations.traces.sampleRateHint')}</span>
        </div>
      )}
    </div>
  );
}

function IntegrationIcon({ type, size = 14 }: { type: IntegrationType; size?: number }) {
  const Icon: React.ElementType = INTEGRATION_ICONS[type] ?? Activity;
  return <Icon size={size} />;
}

function integrationFormFields(
  type: IntegrationType,
  form: Record<string, unknown>,
  onChange: (patch: Record<string, unknown>) => void,
  t: (key: string) => string,
): React.ReactNode {
  const f = (key: string) => `settings.integrations.fields.${key}`;
  switch (type) {
    case 'prometheus':
      return (
        <div className="form-group">
          <label className="form-label">{t(f('prometheus.bearerToken'))} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('settings.integrations.optional')}</span></label>
          <input className="form-input" type="password"
            placeholder={t(f('prometheus.placeholder'))}
            value={(form.authToken as string) ?? ''}
            onChange={e => onChange({ authToken: e.target.value || undefined })} />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            <Trans i18nKey={f('prometheus.description')} components={{ code: <code /> }} />
          </p>
        </div>
      );
    case 'otel':
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('otel.endpoint'))}</label>
              <input className="form-input" type="url"
                placeholder="http://otel-collector:4318"
                value={(form.endpoint as string) ?? ''}
                onChange={e => onChange({ endpoint: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                <Trans i18nKey={f('otel.description')} components={{ code: <code /> }} />
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('otel.protocol'))}</label>
              <SearchableSelect
                options={[{ value: 'http', label: 'HTTP' }, { value: 'grpc', label: 'gRPC' }]}
                value={(form.protocol as string) ?? 'http'}
                onChange={v => onChange({ protocol: v })}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t(f('otel.headers'))} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('settings.integrations.headersHint')}</span></label>
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
            <label className="form-label">{t(f('datadog.apiKey'))}</label>
            <input className="form-input" type="password"
              placeholder={t(f('datadog.placeholder'))}
              value={(form.apiKey as string) ?? ''}
              onChange={e => onChange({ apiKey: e.target.value })}
              required />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <Trans i18nKey={f('datadog.description')} components={{ strong: <strong /> }} />
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">{t(f('datadog.site'))}</label>
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
            <label className="form-label">{t(f('grafana.remoteWriteUrl'))}</label>
            <input className="form-input" type="url"
              placeholder="https://prometheus-prod-01.grafana.net/api/prom/push"
              value={(form.url as string) ?? ''}
              onChange={e => onChange({ url: e.target.value })}
              required />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <Trans i18nKey={f('grafana.description')} components={{ strong: <strong /> }} />
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('grafana.username'))}</label>
              <input className="form-input"
                placeholder="123456"
                value={(form.username as string) ?? ''}
                onChange={e => onChange({ username: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {t(f('grafana.usernameHint'))}
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('grafana.apiKey'))}</label>
              <input className="form-input" type="password"
                placeholder="glc_eyJ..."
                value={(form.apiKey as string) ?? ''}
                onChange={e => onChange({ apiKey: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                <Trans i18nKey={f('grafana.apiKeyHint')} components={{ strong: <strong /> }} />
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
              <label className="form-label">{t(f('influxdb.url'))}</label>
              <input className="form-input" type="url"
                placeholder="http://localhost:8086"
                value={(form.url as string) ?? ''}
                onChange={e => onChange({ url: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                <Trans i18nKey={f('influxdb.urlHint')} components={{ code: <code /> }} />
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('influxdb.token'))}</label>
              <input className="form-input" type="password"
                placeholder={t(f('influxdb.tokenPlaceholder'))}
                value={(form.token as string) ?? ''}
                onChange={e => onChange({ token: e.target.value })}
                required />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                <Trans i18nKey={f('influxdb.tokenHint')} components={{ strong: <strong /> }} />
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('influxdb.org'))}</label>
              <input className="form-input"
                placeholder="my-org"
                value={(form.org as string) ?? ''}
                onChange={e => onChange({ org: e.target.value })}
                required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t(f('influxdb.bucket'))}</label>
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
            <label className="form-label">{t(f('webhook.url'))}</label>
            <input className="form-input" type="url"
              placeholder="https://example.com/metrics-webhook"
              value={(form.url as string) ?? ''}
              onChange={e => onChange({ url: e.target.value })}
              required />
          </div>
          <div className="form-group">
            <label className="form-label">{t(f('webhook.secret'))} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t(f('webhook.secretHint'))}</span></label>
            <input className="form-input" type="password"
              value={(form.secret as string) ?? ''}
              onChange={e => onChange({ secret: e.target.value || undefined })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t(f('webhook.headers'))} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('settings.integrations.headersHint')}</span></label>
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
  const { t } = useTranslation();
  const integrationTypes = useIntegrationTypes();
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
      .catch(e => setError(e instanceof Error ? e.message : t('settings.integrations.errors.loadFailed')))
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
      setError(e instanceof Error ? e.message : t('settings.integrations.errors.updateFailed'));
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
      setError(e instanceof Error ? e.message : t('settings.integrations.errors.saveFailed'));
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
      setError(e instanceof Error ? e.message : t('settings.integrations.errors.deleteFailed'));
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
          {t('settings.integrations.empty')}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: integrations.length > 0 ? 16 : 0 }}>
        {integrations.map(integration => {
          const meta = integrationTypes.find(it => it.type === integration.type);
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
                    {t('settings.integrations.enabled')}
                  </label>
                  {/* Test button */}
                  <button type="button" className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}
                    disabled={testResult === 'testing'}
                    onClick={() => handleTest(integration.id)}>
                    {testResult === 'testing'
                      ? <><div className="spinner" style={{ width: 10, height: 10 }} /> {t('settings.integrations.testing')}</>
                      : t('settings.integrations.test')}
                  </button>
                  {/* Delete */}
                  {pendingDelete === integration.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('settings.integrations.removeConfirm')}</span>
                      <button type="button" onClick={() => handleDelete(integration.id)}
                        style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.1)', color: 'rgb(239,68,68)', cursor: 'pointer' }}>
                        {t('settings.integrations.remove')}
                      </button>
                      <button type="button" onClick={() => setPendingDelete(null)}
                        style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        {t('settings.integrations.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setPendingDelete(integration.id)} title={t('settings.integrations.removeTooltip')}
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
                  {integrationFormFields(integration.type, form, patch => patchForm(integration.id, patch), t)}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button type="button" className="btn btn-primary" disabled={isSaving}
                      style={{ fontSize: '0.83rem' }}
                      onClick={() => handleSave(integration.id)}>
                      {isSaving ? <><div className="spinner" style={{ width: 12, height: 12 }} /> {t('settings.integrations.saving')}</> : <><Save size={13} /> {t('settings.integrations.save')}</>}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={isSaving}
                      style={{ fontSize: '0.83rem' }}
                      onClick={() => handleCancel(integration.id)}>
                      {t('settings.integrations.cancel')}
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
          <Plus size={14} /> {t('settings.integrations.addButton')}
        </button>
        {addOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: 260, zIndex: 100, overflow: 'hidden',
          }}>
            {integrationTypes.map((it, i) => (
              <button key={it.type} type="button" onClick={() => handleAdd(it.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '10px 14px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                  borderBottom: i < integrationTypes.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                <it.Icon size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{it.label}</span>
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
  const { t } = useTranslation();
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
      .catch(e => setError(e instanceof Error ? e.message : t('settings.catalog.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, []);

  async function persist(updated: ProviderRepo[], doRefresh = false) {
    setRepos(updated);
    await updateSettings({ providerRepos: updated } as Partial<Settings>);
    if (doRefresh) {
      const st = await refreshCatalog().catch(() => [] as RepoStatus[]);
      setStatus(st);
    }
    setSaved(t('settings.catalog.saved'));
    setTimeout(() => setSaved(''), 2000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    setAddError('');
    if (repos.some(r => r.url === url)) {
      setAddError(t('settings.catalog.errors.duplicateUrl'));
      return;
    }
    setProbing(true);
    try {
      const probe = await probeRepo(url);
      if (!probe.ok) {
        setAddError(probe.error ?? t('settings.catalog.errors.unreachable'));
        return;
      }
    } catch {
      setAddError(t('settings.catalog.errors.unreachable'));
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
      setEditError(t('settings.catalog.errors.duplicateUrl'));
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
      setSaved(t('settings.catalog.refreshed'));
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
          {t('settings.catalog.heading')}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <button type="button" className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 5 }}
            disabled={refreshing}
            onClick={() => void handleRefresh()}>
            {refreshing ? <><div className="spinner" style={{ width: 10, height: 10 }} /> {t('settings.catalog.refreshing')}</> : t('settings.catalog.refresh')}
          </button>
          {nextRefreshLabel && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('settings.catalog.nextRefresh', { date: nextRefreshLabel })}</span>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
        {t('settings.catalog.priorityHint')}
      </p>

      {saved && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.85rem', color: '#22c55e' }}>
          {saved}
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 0, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', padding: '6px 14px' }}>
          {[t('settings.catalog.columns.priority'), t('settings.catalog.columns.url'), t('settings.catalog.columns.updated'), t('settings.catalog.columns.lastCheck'), t('settings.catalog.columns.status'), ''].map(h => (
            <span key={h} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
          ))}
        </div>

        {repos.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {t('settings.catalog.empty')}
          </div>
        )}

        {repos.map((repo, idx) => {
          const st = status.find(s => s.url === repo.url);
          return (
            <div key={idx} style={{ borderBottom: idx < repos.length - 1 ? '1px solid var(--border)' : 'none' }}>
              {editIdx === idx ? (
                <form onSubmit={e => void handleSaveEdit(e)} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-elevated)' }}>
                  <div>
                    <label className="form-label" htmlFor={`edit-url-${idx}`}>{t('settings.catalog.columns.url')}</label>
                    <input id={`edit-url-${idx}`} className="form-input" type="url" value={editUrl}
                      onChange={e => { setEditUrl(e.target.value); setEditError(''); }} required autoFocus />
                    {editError && <div className="form-error" style={{ marginTop: 4 }}>{editError}</div>}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={editEnabled} onChange={e => setEditEnabled(e.target.checked)} />
                    {t('settings.integrations.enabled')}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '4px 14px' }}>{t('settings.integrations.save')}</button>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 14px' }} onClick={() => setEditIdx(null)}>{t('settings.integrations.cancel')}</button>
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
                    {st?.error ? t('settings.catalog.status.error') : repo.enabled ? t('settings.catalog.status.active') : t('settings.catalog.status.disabled')}
                  </span>
                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '2px 8px' }} onClick={() => startEdit(idx)}>{t('settings.catalog.edit')}</button>
                    <button type="button" onClick={() => setConfirmRemoveIdx(idx)} title={t('settings.catalog.removeTooltip')}
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
          <label className="form-label" htmlFor="catalog-url">{t('settings.catalog.addRepository')}</label>
          <input id="catalog-url" className="form-input" type="url" placeholder="https://example.com/catalog/"
            value={newUrl} onChange={e => { setNewUrl(e.target.value); setAddError(''); }} required />
          {addError && <div className="form-error" style={{ marginTop: 4 }}>{addError}</div>}
        </div>
        <button type="submit" className="btn btn-primary" style={{ fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 5 }} disabled={probing}>
          {probing ? <><div className="spinner" style={{ width: 10, height: 10 }} /> {t('settings.catalog.checking')}</> : <><Plus size={14} /> {t('settings.catalog.add')}</>}
        </button>
      </form>

      {confirmRemoveIdx !== null && (
        <ConfirmDialog
          message={t('settings.catalog.removeConfirm', { url: repos[confirmRemoveIdx]?.url })}
          onConfirm={() => void confirmRemove(confirmRemoveIdx)}
          onCancel={() => setConfirmRemoveIdx(null)}
          confirmLabel={t('settings.catalog.removeTooltip')}
          danger={true}
        />
      )}
    </div>
  );
}

// ── About tab ────────────────────────────────────────────────────────────────

const FALLBACK_RELEASES: AvailableReleases = { channels: ['latest', 'current', 'next'], versions: [] };

function ChannelSelector({
  current,
  onSave,
}: {
  current: string;
  onSave: (ch: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [releases, setReleases] = React.useState<AvailableReleases>(FALLBACK_RELEASES);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [customVal, setCustomVal] = React.useState('');
  const [showCustom, setShowCustom] = React.useState(false);

  React.useEffect(() => {
    getAvailableReleases().then(setReleases).catch(() => setReleases(FALLBACK_RELEASES));
  }, []);

  const normalized = normalizeUpdateChannel(current);
  const deprecatedAlias = normalized.deprecatedAlias;
  const knownValues = [...releases.channels, ...releases.versions];
  const isKnown = knownValues.includes(current) || deprecatedAlias !== undefined;
  const selectValue = deprecatedAlias ? normalized.channel : current;

  React.useEffect(() => {
    setShowCustom(!isKnown);
    if (!isKnown) setCustomVal(current);
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
        {!showCustom && deprecatedAlias && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>stored as {deprecatedAlias} (deprecated)</span>
        )}
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
            value={isKnown ? selectValue : '__custom'}
            onChange={handleSelectChange}
            disabled={saving}
            options={[
              ...releases.channels.map(ch => ({ value: ch, label: ch })),
              { value: '__custom', label: 'custom...' },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// Fixed placeholder shown instead of the real uptime while capturing documentation
// screenshots: the real value is wall-clock derived and differs between two runs of the
// same commit. See ../utils/captureMode.
const CAPTURE_UPTIME_DISPLAY = '2d 4h 17m';

function formatUptime(seconds: number): string {
  if (isCaptureMode()) return CAPTURE_UPTIME_DISPLAY;
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
  const { t } = useTranslation();
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
      .catch(e => setError(e instanceof Error ? e.message : t('settings.about.errors.loadFailed')))
      .finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleChannelSave(ch: string) {
    await updateSettings({ channel: ch });
    /* v8 ignore next */
    setInfo(prev => prev ? { ...prev, channel: ch, rawChannel: ch } : prev);
  }

  async function handleCheckUpdates() {
    setChecking(true);
    setUpdateError('');
    try {
      const result = await checkForUpdates();
      setUpdateInfo(result);
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : t('settings.about.errors.checkFailed'));
    } finally {
      setChecking(false);
    }
  }

  function handleUpdate() {
    setConfirmState({
      message: t('settings.about.confirmUpdate'),
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
            setUpdateMsg(t('settings.about.updateComplete'));
            setTimeout(() => window.location.reload(), 1500);
          }
        } catch { /* still restarting */ }
        if (attempts >= 20) {
          clearInterval(pollRef.current!);
          setUpdating(false);
          setUpdateMsg(t('settings.about.serviceRestarting'));
        }
      }, 3000);
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : t('settings.about.errors.updateFailed'));
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
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>{t('settings.about.headings.application')}</h3>
        <InfoRow label={t('settings.about.labels.version')} value={`v${info.version}`} />
        <ChannelSelector current={info.rawChannel ?? info.channel ?? 'latest'} onSave={handleChannelSave} />
        <InfoRow label={t('settings.about.labels.uptime')} value={formatUptime(info.uptimeSeconds)} />
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>{t('settings.about.headings.runtime')}</h3>
        <InfoRow label={t('settings.about.labels.nodeVersion')} value={info.nodeVersion} />
        <InfoRow label={t('settings.about.labels.platform')} value={info.platform} />
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>{t('settings.about.headings.storage')}</h3>
        <InfoRow label={t('settings.about.labels.configDir')} value={info.configDir} mono />
        <InfoRow label={t('settings.about.labels.dataDir')} value={info.dataDir} mono />
      </div>

      <div>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>{t('settings.about.headings.softwareUpdate')}</h3>
        {updateInfo ? (
          <>
            <InfoRow label={t('settings.about.labels.currentVersion')} value={`v${updateInfo.currentVersion}`} />
            <InfoRow label={t('settings.about.labels.availableVersion')} value={updateInfo.available ? `v${updateInfo.latestVersion}` : t('settings.about.labels.upToDate')} />
            {updateInfo.checkedAt && (
              <InfoRow label={t('settings.about.labels.lastChecked')} value={new Date(updateInfo.checkedAt).toLocaleString()} />
            )}
          </>
        ) : (
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', padding: '9px 0' }}>{t('settings.about.noCheckPerformed')}</p>
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
            {checking ? <><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />{t('settings.about.checking')}</> : t('settings.about.checkForUpdates')}
          </button>
          {!info.isDocker && updateInfo?.available && (
            <button
              className="btn btn-primary"
              onClick={handleUpdate}
              disabled={updating}
              style={{ fontSize: '0.83rem' }}
            >
              {updating ? <><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />{t('settings.about.updating')}</> : t('settings.about.updateTo', { version: updateInfo.latestVersion })}
            </button>
          )}
          {info.isDocker && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', alignSelf: 'center', margin: 0 }}>
              {t('settings.about.dockerHint')}
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
  const { t } = useTranslation();
  const [requireMfa, setRequireMfa] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings()
      .then(s => setRequireMfa(!!s.requireMfa))
      .catch(e => setError(e instanceof Error ? e.message : t('settings.security.errors.loadFailed')))
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
      setError(e instanceof Error ? e.message : t('settings.security.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={13} /> {t('settings.security.authentication')}
        </h3>

        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requireMfa}
              onChange={e => setRequireMfa(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            {t('settings.security.requireMfa')}
          </label>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {t('settings.security.requireMfaHint')}
          </p>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {saved && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.85rem', color: '#22c55e' }}>
          {t('settings.security.savedSuccess')}
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> {t('settings.security.saving')}</> : <><Save size={15} /> {t('settings.security.saveSettings')}</>}
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
