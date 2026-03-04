import React, { useEffect, useState } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { getSettings, updateSettings, getSystemInfo } from '../api';
import type { Settings, SystemInfo, EmailConfig, EmailProvider } from '../api';

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
      setForm({ defaultTimeoutMs: s.defaultTimeoutMs, logLevel: s.logLevel, dashboardEnabled: s.dashboardEnabled, ...(s.notifications ? { notifications: s.notifications } : {}) });
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

        <div className="form-group">
          <label className="form-label">Dashboard</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <input
              id="s-dashboard"
              type="checkbox"
              checked={form.dashboardEnabled ?? true}
              onChange={e => field('dashboardEnabled', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <label htmlFor="s-dashboard" style={{ cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              Enable dashboard UI at <code style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/dashboard</code>
            </label>
          </div>
          {form.dashboardEnabled === false && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginTop: 10, padding: '8px 12px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 8, fontSize: '0.78rem', color: 'var(--warning, #f59e0b)',
            }}>
              <AlertTriangle size={14} />
              Disabling the dashboard will prevent you from accessing this UI after saving.
            </div>
          )}
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

export function SettingsNotificationsTab() {
  const [form, setForm]       = useState<{ notifications?: import('../api').NotificationsConfig }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    getSettings()
      .then(s => setForm(s.notifications ? { notifications: s.notifications } : {}))
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
    } finally {
      setSaving(false);
    }
  }

  const emailCfg  = form.notifications?.email;
  const emailEnabled = !!emailCfg;

  function toggleEmail(enabled: boolean) {
    if (enabled) {
      setForm(f => ({ ...f, notifications: { ...f.notifications, email: { provider: 'smtp' as const, fromAddress: '', host: '', port: 587, secure: false } } }));
    } else {
      setForm(f => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { email: _e, ...rest } = f.notifications ?? {};
        return { ...f, notifications: rest };
      });
    }
  }

  function setEmailProvider(provider: EmailProvider) {
    const fromAddress = emailCfg?.fromAddress ?? '';
    const fromName = emailCfg?.fromName;
    const base = fromName ? { fromAddress, fromName } : { fromAddress };
    let next: EmailConfig;
    switch (provider) {
      case 'ses':      next = { ...base, provider: 'ses', region: '' }; break;
      case 'sendgrid': next = { ...base, provider: 'sendgrid', apiKey: '' }; break;
      case 'azure':    next = { ...base, provider: 'azure', connectionString: '' }; break;
      case 'google':   next = { ...base, provider: 'google', clientId: '', clientSecret: '', refreshToken: '' }; break;
      default:         next = { ...base, provider: 'smtp', host: '', port: 587, secure: false };
    }
    setForm(f => ({ ...f, notifications: { ...f.notifications, email: next } }));
  }

  function ef(key: string, value: unknown) {
    setForm(f => ({ ...f, notifications: { ...f.notifications, email: { ...f.notifications?.email, [key]: value } as EmailConfig } }));
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
      {/* Email channel */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: emailEnabled ? 16 : 0 }}>
          <div>
            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>Email</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>SMTP, SES, SendGrid, Azure, Google</span>
          </div>
          <input type="checkbox" checked={emailEnabled} onChange={e => toggleEmail(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
        </div>

        {emailEnabled && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Provider</label>
                <select className="form-input" value={emailCfg?.provider ?? 'smtp'}
                  onChange={e => setEmailProvider(e.target.value as EmailProvider)}>
                  <option value="smtp">SMTP</option>
                  <option value="ses">Amazon SES</option>
                  <option value="sendgrid">SendGrid</option>
                  <option value="azure">Azure Communication Services</option>
                  <option value="google">Google / Gmail (OAuth)</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">From Address</label>
                <input className="form-input" type="email" value={emailCfg?.fromAddress ?? ''} required
                  onChange={e => ef('fromAddress', e.target.value)} placeholder="noreply@example.com" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">From Name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" value={emailCfg?.fromName ?? ''}
                onChange={e => ef('fromName', e.target.value || undefined)} placeholder="LocalRouter" />
            </div>

            {emailCfg?.provider === 'smtp' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Host</label>
                    <input className="form-input" value={emailCfg.host}
                      onChange={e => ef('host', e.target.value)} placeholder="smtp.example.com" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input className="form-input" type="number" value={emailCfg.port}
                      onChange={e => ef('port', Number(e.target.value))} required />
                  </div>
                </div>
                <div className="form-group">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input id="smtp-secure" type="checkbox" checked={emailCfg.secure}
                      onChange={e => ef('secure', e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    <label htmlFor="smtp-secure" style={{ cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-primary)' }}>Use TLS / SSL</label>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Username <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input className="form-input" value={emailCfg.username ?? ''}
                      onChange={e => ef('username', e.target.value || undefined)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input className="form-input" type="password" value={emailCfg.password ?? ''}
                      onChange={e => ef('password', e.target.value || undefined)} />
                  </div>
                </div>
              </>
            )}

            {emailCfg?.provider === 'ses' && (
              <>
                <div className="form-group">
                  <label className="form-label">AWS Region</label>
                  <input className="form-input" value={emailCfg.region}
                    onChange={e => ef('region', e.target.value)} placeholder="us-east-1" required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Access Key ID <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input className="form-input" value={emailCfg.accessKeyId ?? ''}
                      onChange={e => ef('accessKeyId', e.target.value || undefined)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Secret Access Key <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input className="form-input" type="password" value={emailCfg.secretAccessKey ?? ''}
                      onChange={e => ef('secretAccessKey', e.target.value || undefined)} />
                  </div>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Leave credentials blank to use the IAM instance role.</p>
              </>
            )}

            {emailCfg?.provider === 'sendgrid' && (
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input className="form-input" type="password" value={emailCfg.apiKey}
                  onChange={e => ef('apiKey', e.target.value)} required />
              </div>
            )}

            {emailCfg?.provider === 'azure' && (
              <div className="form-group">
                <label className="form-label">Connection String</label>
                <input className="form-input" value={emailCfg.connectionString}
                  onChange={e => ef('connectionString', e.target.value)} required />
              </div>
            )}

            {emailCfg?.provider === 'google' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Client ID</label>
                    <input className="form-input" value={emailCfg.clientId}
                      onChange={e => ef('clientId', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Client Secret</label>
                    <input className="form-input" type="password" value={emailCfg.clientSecret}
                      onChange={e => ef('clientSecret', e.target.value)} required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Refresh Token</label>
                  <input className="form-input" type="password" value={emailCfg.refreshToken}
                    onChange={e => ef('refreshToken', e.target.value)} required />
                </div>
              </>
            )}
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
