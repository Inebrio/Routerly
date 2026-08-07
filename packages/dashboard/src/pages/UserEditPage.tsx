import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { getUsers, updateUser, getRoles } from '../api';
import type { User, Role } from '../api';
import { SearchableSelect } from '../components/SearchableSelect';

type EditForm = { email: string; roleId: string; newPassword: string };

export function UserEditPage() {
  const { t } = useTranslation();
  const { userId } = useParams<{ userId: string }>();
  const navigate    = useNavigate();

  const [user, setUser]       = useState<User | null>(null);
  const [roles, setRoles]     = useState<Role[]>([]);
  const [form, setForm]       = useState<EditForm>({ email: '', roleId: '', newPassword: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    Promise.all([getUsers(), getRoles()])
      .then(([users, allRoles]) => {
        const u = users.find(u => u.id === userId);
        if (!u) { navigate('/dashboard/settings/users', { replace: true }); return; }
        setUser(u);
        setRoles(allRoles);
        setForm({ email: u.email, roleId: u.roleId, newPassword: '' });
      })
      .catch(e => setError(e instanceof Error ? e.message : t('userEdit.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, [userId]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    /* v8 ignore next */
    if (!user) return;
    setError(''); setSaving(true); setSaved(false);
    try {
      const payload: { email?: string; roleId?: string; newPassword?: string } = {};
      if (form.email !== user.email) payload.email = form.email;
      if (form.roleId !== user.roleId) payload.roleId = form.roleId;
      if (form.newPassword) payload.newPassword = form.newPassword;
      const updated = await updateUser(user.id, payload);
      setUser(updated);
      setForm(f => ({ ...f, newPassword: '' }));
      setSaved(true);
      setTimeout(/* v8 ignore next */ () => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('userEdit.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => navigate('/dashboard/settings/users')}>
          <ArrowLeft size={15} />
        </button>
        <div>
          <h1 style={{ margin: 0 }}>{t('userEdit.title')}</h1>
          <p style={{ margin: 0 }}>{user?.email}</p>
        </div>
      </div>

      <div className="page-body">
        <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
          {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

          <div style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('userEdit.account')}
            </h3>
            <div className="form-group">
              <label className="form-label">{t('userEdit.email')}</label>
              <input className="form-input" type="email" value={form.email} required
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('userEdit.role')}</label>
              <SearchableSelect
                options={roles.map(r => ({ value: r.id, label: r.name }))}
                value={form.roleId}
                onChange={v => setForm(f => ({ ...f, roleId: v }))}
              />
            </div>
          </div>

          <div style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('userEdit.changePassword')}
            </h3>
            <div className="form-group">
              <label className="form-label">
                {t('userEdit.newPassword')}{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('userEdit.newPasswordHint')}</span>
              </label>
              <input className="form-input" type="password" value={form.newPassword} placeholder="••••••••"
                onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : <><Save size={15} /> {t('userEdit.save')}</>}
            </button>
            {saved && <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>{t('userEdit.saved')}</span>}
          </div>
        </form>
      </div>
    </>
  );
}
