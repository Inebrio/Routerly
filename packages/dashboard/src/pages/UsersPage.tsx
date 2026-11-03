import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Users, Pencil, ShieldOff } from 'lucide-react';
import { getUsers, createUser, deleteUser, reset2faForUser, type User } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../AuthContext';

type AddForm = { email: string; password: string; roleId: string };

export function UsersPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canRead  = can('user:read');
  const canWrite = can('user:write');
  const [users, setUsers]         = useState<User[]>([]);
  const [loadErr, setLoadErr]     = useState('');
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [addForm, setAddForm]     = useState<AddForm>({ email: '', password: '', roleId: 'viewer' });
  const [addErr, setAddErr]       = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const navigate = useNavigate();

  useEffect(() => { if (canRead) load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    try {
      setUsers(await getUsers());
      setLoadErr('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('users.errors.loadFailed'));
    } finally { setLoading(false); }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddErr(''); setAddSaving(true);
    try {
      await createUser(addForm);
      setShowAdd(false);
      setAddForm({ email: '', password: '', roleId: 'viewer' });
      await load();
    } catch (e) { setAddErr(e instanceof Error ? e.message : t('users.errors.addFailed')); }
    finally { setAddSaving(false); }
  }

  function handleDelete(id: string) {
    setConfirmState({
      message: t('users.deleteConfirm'),
      onConfirm: async () => {
        setConfirmState(null);
        await deleteUser(id);
        setUsers(u => u.filter(x => x.id !== id));
      },
    });
  }

  function handleReset2fa(id: string, email: string) {
    setConfirmState({
      message: t('users.resetTwoFaConfirm', { email }),
      onConfirm: async () => {
        setConfirmState(null);
        await reset2faForUser(id);
        setUsers(u => u.map(x => x.id === id ? { ...x, totpEnabled: false } : x));
      },
    });
  }

  if (!canRead) {
    return <div className="empty-state"><ShieldOff size={40} /><p>{t('users.noPermission')}</p></div>;
  }

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">{t('users.countLabel', { count: users.length })}</span>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> {t('users.addButton')}
          </button>
        )}
      </div>

      {loadErr && <div className="form-error" style={{ margin: '0 20px' }}>{loadErr}</div>}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : users.length === 0 ? (
        <div className="empty-state"><Users size={40} /><p>{t('users.emptyTitle')}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('users.columns.email')}</th><th>{t('users.columns.role')}</th><th>{t('users.columns.routers')}</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr
                  key={u.id}
                  {...(canWrite ? {
                    style: { cursor: 'pointer' },
                    onClick: () => navigate(`/dashboard/settings/users/${u.id}`),
                  } : {})}
                >
                  <td><strong style={{ color: 'var(--text-primary)' }}>{u.email}</strong></td>
                  <td><span className={`badge ${u.roleId === 'admin' ? 'badge-success' : 'badge-ollama'}`}>{u.roleId}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {u.routerIds.length === 0 ? t('users.allRouters') : u.routerIds.join(', ')}
                  </td>
                  <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    {canWrite && u.totpEnabled && (
                      <button className="btn-icon" title={t('users.resetTwoFaTitle')} onClick={() => handleReset2fa(u.id, u.email)}>
                        <ShieldOff size={14} />
                      </button>
                    )}
                    {canWrite && (
                      <>
                        <button className="btn-icon" onClick={() => navigate(`/dashboard/settings/users/${u.id}`)}>
                          <Pencil size={14} />
                        </button>
                        <button className="btn-icon danger" onClick={() => handleDelete(u.id)}>
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add modal ── */}
      {showAdd && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal">
            <h2 className="modal-title">{t('users.modal.title')}</h2>
            <form onSubmit={handleAdd}>
              {addErr && <div className="form-error">{addErr}</div>}
              <div className="form-group">
                <label className="form-label">{t('users.modal.emailLabel')}</label>
                <input className="form-input" type="email" value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder={t('users.modal.emailPlaceholder')} required />
              </div>
              <div className="form-group">
                <label className="form-label">{t('users.modal.passwordLabel')}</label>
                <input className="form-input" type="password" value={addForm.password}
                  onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder={t('users.modal.passwordPlaceholder')} required />
              </div>
              <div className="form-group">
                <label className="form-label">{t('users.modal.roleLabel')}</label>
                <SearchableSelect
                  options={[{ value: 'admin', label: t('users.modal.roleAdmin') }, { value: 'viewer', label: t('users.modal.roleViewer') }]}
                  value={addForm.roleId}
                  onChange={v => setAddForm(f => ({ ...f, roleId: v }))}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>{t('users.modal.cancelButton')}</button>
                <button type="submit" className="btn btn-primary" disabled={addSaving}>
                  {addSaving ? <span className="spinner" /> : t('users.modal.submitButton')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}
