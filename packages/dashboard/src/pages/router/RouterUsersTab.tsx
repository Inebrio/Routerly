import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { useRouter } from './RouterLayout';
import { getUsers, addRouterMember, updateRouterMember, removeRouterMember, User } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SearchableSelect } from '../../components/SearchableSelect';

export function RouterUsersTab() {
  const { t } = useTranslation();
  const { router, setRouter } = useRouter();
  if (!router) return null;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('viewer');

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('viewer');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const roleOptions = [
    { value: 'viewer', label: t('routers.users.roles.viewer') },
    { value: 'editor', label: t('routers.users.roles.editor') },
    { value: 'admin', label: t('routers.users.roles.admin') },
  ];

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch((e) => setErr(e instanceof Error ? e.message : t('routers.users.errors.loadFailed')));
  }, []);

  async function handleAddMember() {
    /* v8 ignore next */
    if (!newUserId) return;
    setErr('');
    setLoading(true);
    try {
      const member = await addRouterMember(router!.id, newUserId, newRole);
      setRouter(p => {
        /* v8 ignore next */
        if (!p) return p;
        const members = p.members ? [...p.members] : /* v8 ignore next */ [];
        members.push(member);
        return { ...p, members };
      });
      setAdding(false);
      setNewUserId('');
      setNewRole('viewer');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('routers.users.errors.addFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateMember(userId: string) {
    setErr('');
    setLoading(true);
    try {
      const updated = await updateRouterMember(router!.id, userId, editRole);
      setRouter(p => {
        /* v8 ignore next */
        if (!p) return p;
        /* v8 ignore next */
        const members = p.members?.map(m => m.userId === userId ? updated : m) || [];
        return { ...p, members };
      });
      setEditingUserId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('routers.users.errors.updateFailed'));
    } finally {
      setLoading(false);
    }
  }

  function handleRemoveMember(userId: string) {
    setConfirmState({
      message: t('routers.users.removeConfirm'),
      onConfirm: async () => {
        setConfirmState(null);
        setErr('');
        setLoading(true);
        try {
          await removeRouterMember(router!.id, userId);
          setRouter(p => {
            /* v8 ignore next */
            if (!p) return p;
            /* v8 ignore next */
            return { ...p, members: p.members?.filter(m => m.userId !== userId) || [] };
          });
        } catch (e) {
          setErr(e instanceof Error ? e.message : t('routers.users.errors.removeFailed'));
        } finally {
          setLoading(false);
        }
      },
    });
  }

  const members = router.members || [];
  const availableUsers = users.filter(u => !members.find(m => m.userId === u.id));

  return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{t('routers.users.title')}</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            {t('routers.users.description')}
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} disabled={loading}>
            <Plus size={16} />
            {t('routers.users.addButton')}
          </button>
        )}
      </div>

      {adding && (
        <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px dashed var(--border)', background: 'var(--surface-active)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>{t('routers.users.addNewTitle')}</h4>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <SearchableSelect
                value={newUserId}
                onChange={setNewUserId}
                disabled={loading}
                placeholder={t('routers.users.selectUserPlaceholder')}
                options={availableUsers.map(u => ({ value: u.id, label: u.email }))}
              />
            </div>
            <div style={{ width: 140 }}>
              <SearchableSelect
                value={newRole}
                onChange={setNewRole}
                disabled={loading}
                options={roleOptions}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleAddMember} disabled={loading || !newUserId}>{t('routers.users.addConfirmButton')}</button>
              <button className="btn btn-secondary" onClick={() => setAdding(false)} disabled={loading}>{t('routers.users.cancelButton')}</button>
            </div>
          </div>
        </div>
      )}

      {members.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          {t('routers.users.empty')}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('routers.users.columns.user')}</th>
                <th style={{ width: 200 }}>{t('routers.users.columns.role')}</th>
                <th style={{ width: 100, textAlign: 'right' }}>{t('routers.users.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map(member => {
                const user = users.find(u => u.id === member.userId);
                const isEditing = editingUserId === member.userId;

                return (
                  <tr
                    key={member.userId}
                    {...(isEditing ? {} : {
                      style: { cursor: 'pointer' },
                      onClick: () => { setEditingUserId(member.userId); setEditRole(member.role); },
                    })}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {user?.email || <span style={{ color: 'var(--text-muted)' }}>{member.userId}</span>}
                      </div>
                    </td>
                    <td>
                      {isEditing ? (
                        <SearchableSelect
                          value={editRole}
                          onChange={setEditRole}
                          disabled={loading}
                          options={roleOptions}
                        />
                      ) : (
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: '0.75rem',
                          background: 'var(--surface-active)',
                          border: '1px solid var(--border)',
                          textTransform: 'capitalize'
                        }}>
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 6 }} onClick={e => e.stopPropagation()}>
                      {isEditing ? (
                        <>
                          <button className="btn-icon" onClick={() => handleUpdateMember(member.userId)} disabled={loading} title={t('routers.users.saveTitle')}>
                            <Check size={16} />
                          </button>
                          <button className="btn-icon" onClick={() => setEditingUserId(null)} disabled={loading} title={t('routers.users.cancelButton')}>
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn-icon"
                            onClick={() => { setEditingUserId(member.userId); setEditRole(member.role); }}
                            disabled={loading}
                            title={t('routers.users.changeRoleTitle')}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleRemoveMember(member.userId)}
                            disabled={loading}
                            title={t('routers.users.removeTitle')}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
