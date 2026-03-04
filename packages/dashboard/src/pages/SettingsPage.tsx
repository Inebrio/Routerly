import React, { useEffect, useRef, useState } from 'react';
import { Save, Plus, Trash2, Mail, Search, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { getSettings, updateSettings, getSystemInfo, testNotificationChannel } from '../api';
import type { Settings, SystemInfo } from '../api';

const LOG_LEVELS: Settings['logLevel'][] = ['trace', 'debug', 'info', 'warn', 'error'];

// ── General tab ───────────────────────────────────────────────────────────────

export function SettingsGeneralTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Partial<Settings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const s = await getSettings();
      setSettings(s);
      setForm({ defaultTimeoutMs: s.defaultTimeoutMs, logLevel: s.logLevel, publicUrl: s.publicUrl || `http://localhost:${s.port}`, ...(s.notifications ? { notifications: s.notifications } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
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

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
          Server Info
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="form-label">Host</label>
            <input className="form-input" value={settings?.host ?? ''} disabled readOnly />
          </div>
          <div>
            <label className="form-label">Port</label>
            <input className="form-input" value={settings?.port ?? ''} disabled readOnly />
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Host and port are configured via environment variables or the settings file and cannot be changed here.
        </p>
        <div className="form-group" style={{ marginTop: 14 }}>
          <label className="form-label" htmlFor="s-publicurl">Service Host</label>
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

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
          Runtime Settings
        </h3>

        <div className="form-group">
          <label className="form-label" htmlFor="s-timeout">Default Request Timeout (ms)</label>
          <input
            id="s-timeout"
            type="number"
            className="form-input"
            min={1000}
            max={300000}
            step={1000}
            value={form.defaultTimeoutMs ?? ''}
            onChange={e => field('defaultTimeoutMs', Number(e.target.value))}
            required
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Maximum time to wait for a model response per attempt. Can be overridden per project.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="s-loglevel">Log Level</label>
          <select
            id="s-loglevel"
            className="form-input"
            value={form.logLevel ?? 'info'}
            onChange={e => field('logLevel', e.target.value as Settings['logLevel'])}
          >
            {LOG_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Controls the verbosity of service logs.
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

// ── Notifications tab ────────────────────────────────────────────────────────

type NotifForm = { notifications?: import('../api').NotificationsConfig };
type EProvider = import('../api').ChannelProvider;
type EChannel  = import('../api').NotificationChannel;

const CHANNEL_PROVIDERS: Array<{ key: EProvider; label: string; description: string }> = [
  { key: 'smtp',      label: 'SMTP',               description: 'Custom mail server' },
  { key: 'ses',       label: 'Amazon SES',          description: 'AWS Simple Email Service' },
  { key: 'sendgrid',  label: 'SendGrid',            description: 'Twilio SendGrid' },
  { key: 'azure',     label: 'Azure Communication', description: 'Azure Communication Services' },
  { key: 'google',    label: 'Google / Gmail',       description: 'Gmail via OAuth2' },
  { key: 'webhook',   label: 'Webhook',             description: 'HTTP webhook callback' },
];

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
        // Collapse all existing channels by default
        const ids = notif?.channels?.map(ch => ch.id) ?? [];
        if (ids.length) setCollapsed(Object.fromEntries(ids.map(id => [id, true])));
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaving(true); setSaved(false);
    try {
      await updateSettings(form);
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
      smtp:     { id, provider: 'smtp',     fromAddress: '', host: '', port: 587, secure: false },
      ses:      { id, provider: 'ses',      fromAddress: '', region: '' },
      sendgrid: { id, provider: 'sendgrid', fromAddress: '', apiKey: '' },
      azure:    { id, provider: 'azure',    fromAddress: '', connectionString: '' },
      google:   { id, provider: 'google',   fromAddress: '', clientId: '', clientSecret: '', refreshToken: '' },
      webhook:  { id, provider: 'webhook',  url: '' },
    };
    setForm(f => ({ ...f, notifications: { channels: [...(f.notifications?.channels ?? []), defaults[provider]] } }));
    setCollapsed(c => ({ ...c, [id]: false }));
  }

  function removeChannel(id: string) {
    setForm(f => ({ ...f, notifications: { channels: (f.notifications?.channels ?? []).filter(ch => ch.id !== id) } }));
  }

  function uf(id: string, field: string, value: unknown) {
    setForm(f => ({
      ...f,
      notifications: { channels: (f.notifications?.channels ?? []).map(ch => ch.id === id ? { ...ch, [field]: value } : ch) },
    }));
  }

  async function sendTest(id: string, provider: EProvider) {
    const to = (testTo[id] ?? '').trim();
    if (provider !== 'webhook' && !to) return;
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
    const st = testStatus[ch.id];
    const isWebhook = ch.provider === 'webhook';
    return (
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {isWebhook ? 'Ping' : 'Send test'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isWebhook && (
            <input type="email" className="form-input" style={{ flex: 1, margin: 0 }}
              placeholder="recipient@example.com"
              value={testTo[ch.id] ?? ''}
              onChange={e => setTestTo(t => ({ ...t, [ch.id]: e.target.value }))} />
          )}
          <button type="button" className="btn btn-secondary"
            disabled={st?.loading || (!isWebhook && !testTo[ch.id]?.trim())}
            onClick={() => sendTest(ch.id, ch.provider)}
            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            {st?.loading
              ? <><div className="spinner" style={{ width: 12, height: 12 }} /> Sending…</>
              : isWebhook ? 'Send Ping' : 'Send Test'}
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
    if (ch.provider === 'webhook') return null;
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
            onChange={e => uf(ch.id, 'fromName', e.target.value || undefined)} placeholder="LocalRouter" />
        </div>
      </div>
    );
  }

  function channelFields(ch: EChannel) {
    switch (ch.provider) {
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
                  setForm(f => ({ ...f, notifications: { channels: (f.notifications?.channels ?? []).map(c => c.id === ch.id ? { ...c, secure, port } : c) } }));
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
        </>
      );
      case 'sendgrid': return (
        <>
          {emailBaseFields(ch)}
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input className="form-input" type="password" value={ch.apiKey} onChange={e => uf(ch.id, 'apiKey', e.target.value)} required />
          </div>
        </>
      );
      case 'azure': return (
        <>
          {emailBaseFields(ch)}
          <div className="form-group">
            <label className="form-label">Connection String</label>
            <input className="form-input" value={ch.connectionString} onChange={e => uf(ch.id, 'connectionString', e.target.value)} required />
          </div>
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
              <select className="form-input" value={ch.method ?? 'POST'} onChange={e => uf(ch.id, 'method', e.target.value)}>
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Secret <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" type="password" value={ch.secret ?? ''} onChange={e => uf(ch.id, 'secret', e.target.value || undefined)} placeholder="HMAC signing key" />
            </div>
          </div>
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
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
      {channels.length === 0 && (
        <div style={{ padding: '40px 0 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No notification channels configured yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: channels.length > 0 ? 16 : 0 }}>
        {channels.map(ch => {
          const isCollapsed = collapsed[ch.id] ?? false;
          const meta = CHANNEL_PROVIDERS.find(p => p.key === ch.provider);
          const isWebhook = ch.provider === 'webhook';
          return (
            <div key={ch.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={cardHeaderStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <button type="button"
                    onClick={() => setCollapsed(c => ({ ...c, [ch.id]: !isCollapsed }))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', flexShrink: 0 }}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {isWebhook
                    ? <Globe size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    : <Mail  size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{meta?.label}</span>
                  <input value={ch.name ?? ''}
                    onChange={e => uf(ch.id, 'name', e.target.value || undefined)}
                    placeholder="Label (optional)"
                    style={{ background: 'none', border: 'none', outline: 'none', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, flex: 1 }} />
                </div>
                {removeActions(ch.id)}
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
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: 260, zIndex: 100, overflow: 'hidden',
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

// ── About tab ───────────────────────────────────────────────────────────────

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

  useEffect(() => {
    getSystemInfo()
      .then(setInfo)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;
  if (error) return <div className="form-error">{error}</div>;
  if (!info) return null;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Application</h3>
        <InfoRow label="Version" value={`v${info.version}`} />
        <InfoRow label="Uptime" value={formatUptime(info.uptimeSeconds)} />
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Runtime</h3>
        <InfoRow label="Node.js" value={info.nodeVersion} />
        <InfoRow label="Platform" value={info.platform} />
      </div>

      <div>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Storage</h3>
        <InfoRow label="Config directory" value={info.configDir} mono />
        <InfoRow label="Data directory" value={info.dataDir} mono />
      </div>
    </div>
  );
}

// ── Page layout ───────────────────────────────────────────────────────────────

const TABS = [
  { path: 'general',       label: 'General' },
  { path: 'notifications', label: 'Notifications' },
  { path: 'users',         label: 'Users' },
  { path: 'about',         label: 'About' },
];

export function SettingsPage() {
  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>Settings</h1>
        <p>Configuration for LocalRouter</p>

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
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
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
