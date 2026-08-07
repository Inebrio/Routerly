import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { createNotificationChannel, getRoles, getUsers } from '../api';
import type { Role, User } from '../api';
import {
  getChannelProviderMeta,
  ChannelEditFields,
  RoutingEditFields,
  RecipientsEditFields,
  providerLabel,
} from './notificationChannelFields';
import type { ChannelProvider } from './notificationChannelFields';

function buildDefaults(provider: ChannelProvider): Record<string, unknown> {
  const base: Record<string, unknown> = { provider };
  switch (provider) {
    case 'smtp':
      return { ...base, fromAddress: '', host: '', port: 587, secure: false };
    case 'ses':
      return { ...base, fromAddress: '', region: '' };
    case 'sendgrid':
      return { ...base, fromAddress: '', apiKey: '' };
    case 'azure':
      return { ...base, fromAddress: '', connectionString: '' };
    case 'google':
      return { ...base, fromAddress: '', clientId: '', clientSecret: '', refreshToken: '' };
    case 'webhook':
      return { ...base, url: '', method: 'POST' };
    case 'slack':
      return { ...base, botToken: '', channelId: '' };
    case 'teams':
      return { ...base, webhookUrl: '' };
    case 'pagerduty':
      return { ...base, integrationKey: '' };
    case 'discord':
      return { ...base, webhookUrl: '' };
    case 'dashboard':
    default:
      return base;
  }
}

export function NotificationChannelCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const providerParam = searchParams.get('provider') as ChannelProvider | null;

  const [provider, setProvider] = useState<ChannelProvider | null>(providerParam);
  const [form, setForm] = useState<Record<string, unknown>>(
    providerParam ? buildDefaults(providerParam) : {},
  );
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'connection' | 'routing' | 'recipients'>('connection');

  useEffect(() => {
    getRoles().then(setRoles).catch(() => {});
    getUsers().then(setUsers).catch(() => {});
  }, []);

  const channelProviderMeta = useMemo(() => getChannelProviderMeta(t), [t]);

  function selectProvider(p: ChannelProvider) {
    setProvider(p);
    setForm(buildDefaults(p));
    setError('');
    setActiveTab('connection');
  }

  function onChange(field: string, value: unknown) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    setError('');
    setSaving(true);
    try {
      // Clean empty events/targets before sending
      const body: Record<string, unknown> = { ...form };
      if (Array.isArray(body['events']) && (body['events'] as string[]).length === 0) {
        delete body['events'];
      }
      if (body['targets']) {
        const targets = body['targets'] as Record<string, unknown>;
        const clean: Record<string, unknown> = {};
        if (Array.isArray(targets['roles']) && (targets['roles'] as string[]).length)             clean['roles']       = targets['roles'];
        if (Array.isArray(targets['permissions']) && (targets['permissions'] as string[]).length) clean['permissions'] = targets['permissions'];
        if (Array.isArray(targets['users']) && (targets['users'] as string[]).length)             clean['users']       = targets['users'];
        if (Object.keys(clean).length) body['targets'] = clean;
        else delete body['targets'];
      }
      // Remove empty string values for optional fields
      for (const key of Object.keys(body)) {
        if (body[key] === '') delete body[key];
      }

      const created = await createNotificationChannel(body);
      navigate(`/dashboard/settings/notifications/${created.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.notifications.create.errors.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Provider picker view
  if (!provider) {
    return (
      <>
        <div style={{ marginBottom: 24 }}>
          <button
            type="button"
            className="btn-icon"
            style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: 4, width: 'fit-content' }}
            onClick={() => navigate('/dashboard/settings/notifications')}
          >
            <ArrowLeft size={16} />
            <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{t('settings.notifications.create.backToList')}</span>
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('settings.notifications.create.pickerHeading')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>{t('settings.notifications.create.pickerSubtitle')}</p>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxWidth: 500 }}>
          {channelProviderMeta.map((p, i) => (
            <button key={p.key} type="button"
              onClick={() => selectProvider(p.key)}
              style={{
                display: 'flex', flexDirection: 'column', width: '100%',
                padding: '12px 16px', background: 'none', border: 'none',
                cursor: 'pointer', textAlign: 'left',
                borderBottom: i < channelProviderMeta.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{p.label}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.description}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <button
          type="button"
          className="btn-icon"
          style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: 4, width: 'fit-content' }}
          onClick={() => { setProvider(null); setForm({}); }}
        >
          <ArrowLeft size={16} />
          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{t('settings.notifications.create.changeType')}</span>
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('settings.notifications.create.heading', { provider: providerLabel(provider, t) })}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>{t('settings.notifications.create.subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} autoComplete="off" style={{ maxWidth: 600 }}>
        {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
          {(['connection', 'routing', 'recipients'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0 4px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.9rem', fontWeight: 500,
                color: activeTab === tab ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -1,
                transition: 'all 0.2s',
                textTransform: 'capitalize',
              }}
            >
              {t(`settings.notifications.form.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {activeTab === 'connection' && (
          <div className="form-section">
            <h3 className="section-title">{t('settings.notifications.form.sections.channelSettings')}</h3>
            <div className="form-group">
              <label className="form-label">
                {t('settings.notifications.form.nameLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('settings.notifications.fields.optional')}</span>
              </label>
              <input
                className="form-input"
                value={typeof form['name'] === 'string' ? form['name'] : ''}
                onChange={e => onChange('name', e.target.value || undefined)}
                placeholder={t('settings.notifications.form.namePlaceholder')}
              />
            </div>
            <ChannelEditFields form={form} onChange={onChange} isEdit={false} t={t} />
          </div>
        )}

        {activeTab === 'routing' && (
          <div className="form-section">
            <h3 className="section-title">{t('settings.notifications.form.sections.eventsRouting')}</h3>
            <RoutingEditFields form={form} onChange={onChange} t={t} />
          </div>
        )}

        {activeTab === 'recipients' && (
          <div className="form-section">
            <h3 className="section-title">{t('settings.notifications.form.sections.recipients')}</h3>
            <RecipientsEditFields form={form} onChange={onChange} roles={roles} users={users} t={t} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/dashboard/settings/notifications')}
            disabled={saving}
          >
            {t('settings.notifications.form.cancelButton')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {t('settings.notifications.create.creatingButton')}</>
              : t('settings.notifications.create.createButton')}
          </button>
        </div>
      </form>
    </>
  );
}
