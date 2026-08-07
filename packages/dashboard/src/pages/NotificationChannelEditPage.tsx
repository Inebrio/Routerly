import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { getNotificationChannel, updateNotificationChannel, testNotificationChannel, getRoles, getUsers } from '../api';
import type { RedactedChannel, Role, User } from '../api';
import {
  ChannelEditFields,
  RoutingEditFields,
  RecipientsEditFields,
  providerLabel,
} from './notificationChannelFields';
import type { ChannelProvider } from './notificationChannelFields';
import { CHANNEL_SECRET_FIELDS } from '@routerly/shared';

/** Strip masked markers from the stored channel so secret fields start blank in the form. */
function buildInitialForm(channel: RedactedChannel): Record<string, unknown> {
  const form: Record<string, unknown> = { ...channel };
  const provider = channel.provider as ChannelProvider;
  const secrets = CHANNEL_SECRET_FIELDS[provider] ?? [];
  for (const field of secrets) {
    delete form[field];
  }
  return form;
}

export function NotificationChannelEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<RedactedChannel | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testStatus, setTestStatus] = useState<{ loading: boolean; ok?: boolean; message?: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [activeTab, setActiveTab] = useState<'connection' | 'routing' | 'recipients'>('connection');

  useEffect(() => {
    /* v8 ignore next */
    if (!id) return;
    Promise.all([
      getNotificationChannel(id),
      getRoles().catch(() => [] as Role[]),
      getUsers().catch(() => [] as User[]),
    ])
      .then(([ch, r, u]) => {
        setChannel(ch);
        setForm(buildInitialForm(ch));
        setRoles(r);
        setUsers(u);
      })
      .catch(e => setError(e instanceof Error ? e.message : t('settings.notifications.edit.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, [id]);

  function onChange(field: string, value: unknown) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    /* v8 ignore next 3 */
    if (!id || !channel) return;
    setError('');
    setSaving(true);
    try {
      const provider = channel.provider as ChannelProvider;
      const secrets = CHANNEL_SECRET_FIELDS[provider] ?? [];

      const patch: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(form)) {
        if (key === 'id' || key === 'provider') continue;
        if (secrets.includes(key)) {
          if (typeof val === 'string' && val.length > 0) patch[key] = val;
        } else {
          patch[key] = val;
        }
      }
      if (Array.isArray(patch['events']) && (patch['events'] as string[]).length === 0) {
        delete patch['events'];
      }
      if (patch['targets']) {
        const targets = patch['targets'] as Record<string, unknown>;
        const clean: Record<string, unknown> = {};
        if (Array.isArray(targets['roles']) && (targets['roles'] as string[]).length)             clean['roles']       = targets['roles'];
        if (Array.isArray(targets['permissions']) && (targets['permissions'] as string[]).length) clean['permissions'] = targets['permissions'];
        if (Array.isArray(targets['users']) && (targets['users'] as string[]).length)             clean['users']       = targets['users'];
        if (Object.keys(clean).length) patch['targets'] = clean;
        else delete patch['targets'];
      }

      await updateNotificationChannel(id, patch);
      navigate('/dashboard/settings/notifications');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.notifications.edit.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    /* v8 ignore next */
    if (!id || !channel) return;
    setTestStatus({ loading: true });
    try {
      const res = await testNotificationChannel(id, testTo);
      setTestStatus({ loading: false, ok: res.ok, message: res.message });
      // A dashboard-channel test writes to the in-app inbox; refresh the bell now.
      if (res.ok) window.dispatchEvent(new Event('routerly:notifications'));
    } catch (e) {
      setTestStatus({ loading: false, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  if (error && !channel) {
    return (
      <>
        <button
          type="button"
          className="btn-icon"
          style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6, padding: 4, width: 'fit-content' }}
          onClick={() => navigate('/dashboard/settings/notifications')}
        >
          <ArrowLeft size={16} />
          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{t('settings.notifications.edit.back')}</span>
        </button>
        <div className="form-error">{error}</div>
      </>
    );
  }

  /* v8 ignore next */
  const provider = (channel?.provider ?? '') as ChannelProvider;
  // Only email-provider channels take a recipient; native/webhook/dashboard ignore it.
  const EMAIL_PROVIDERS = new Set<ChannelProvider>(['smtp', 'ses', 'sendgrid', 'azure', 'google']);
  const showRecipient = EMAIL_PROVIDERS.has(provider);

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
          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{t('settings.notifications.edit.backToList')}</span>
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('settings.notifications.edit.heading', { provider: providerLabel(provider, t) })}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>
          {t('settings.notifications.edit.subtitle')}
        </p>
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
            <ChannelEditFields form={form} onChange={onChange} isEdit={true} t={t} />
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

          {/* Test section */}
          <div className="form-section">
            <h3 className="section-title">{t('settings.notifications.edit.testSection.title')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {showRecipient && (
                  <input
                    type="email"
                    className="form-input"
                    style={{ flex: 1, maxWidth: 320 }}
                    placeholder={t('settings.notifications.edit.testSection.recipientPlaceholder')}
                    value={testTo}
                    onChange={e => setTestTo(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={testStatus?.loading}
                  onClick={handleTest}
                  style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {testStatus?.loading
                    ? <><div className="spinner" style={{ width: 12, height: 12 }} /> {t('settings.notifications.edit.testSection.sendingButton')}</>
                    : <><FlaskConical size={13} /> {t('settings.notifications.edit.testSection.sendButton')}</>}
                </button>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                {showRecipient
                  ? t('settings.notifications.edit.testSection.hintEmail')
                  : t('settings.notifications.edit.testSection.hintOther')}
              </p>
              {testStatus && !testStatus.loading && (
                <div style={{
                  fontSize: '0.8rem', padding: '6px 10px', borderRadius: 6,
                  background: testStatus.ok ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--danger) 12%, transparent)',
                  border: `1px solid ${testStatus.ok ? 'color-mix(in srgb, var(--success) 35%, transparent)' : 'color-mix(in srgb, var(--danger) 35%, transparent)'}`,
                  color: testStatus.ok ? 'var(--success)' : 'var(--danger)',
                }}>
                  {testStatus.ok ? '✓ ' : '✕ '}{testStatus.message}
                </div>
              )}
            </div>
          </div>

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
                ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {t('settings.notifications.edit.savingButton')}</>
                : t('settings.notifications.edit.saveButton')}
            </button>
          </div>
        </form>
    </>
  );
}
