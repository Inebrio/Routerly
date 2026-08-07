import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, Trash2, Lock, Save, X } from 'lucide-react';
import { getRoles, createRole, updateRole, deleteRole, ALL_PERMISSIONS } from '../api';
import type { Role, Permission } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

function permLabels(t: TFunction): Record<Permission, string> {
  return {
    'router:read':       t('roles.permissions.routerRead'),
    'router:write':      t('roles.permissions.routerWrite'),
    'model:read':         t('roles.permissions.modelRead'),
    'model:write':        t('roles.permissions.modelWrite'),
    'user:read':          t('roles.permissions.userRead'),
    'user:write':         t('roles.permissions.userWrite'),
    'report:read':        t('roles.permissions.reportRead'),
    'settings:read':      t('roles.permissions.settingsRead'),
    'settings:write':     t('roles.permissions.settingsWrite'),
    'notification:write': t('roles.permissions.notificationWrite'),
    'token:read':         t('roles.permissions.tokenRead'),
    'token:write':        t('roles.permissions.tokenWrite'),
    'role:write':         t('roles.permissions.roleWrite'),
    'audit:read':         t('roles.permissions.auditRead'),
    'modules:read':       t('roles.permissions.modulesRead'),
    'modules:manage':     t('roles.permissions.modulesManage'),
    'connections:read':   t('roles.permissions.connectionsRead'),
    'connections:manage': t('roles.permissions.connectionsManage'),
    'resilience:read':    t('roles.permissions.resilienceRead'),
    'resilience:manage':  t('roles.permissions.resilienceManage'),
    'profiles:read':      t('roles.permissions.profilesRead'),
    'profiles:manage':    t('roles.permissions.profilesManage'),
    'optimizers:read':    t('roles.permissions.optimizersRead'),
    'optimizers:manage':  t('roles.permissions.optimizersManage'),
    'experiments:read':   t('roles.permissions.experimentsRead'),
    'experiments:manage': t('roles.permissions.experimentsManage'),
  };
}

interface RoleFormState {
  id: string;
  name: string;
  permissions: Permission[];
}

const EMPTY_FORM: RoleFormState = { id: '', name: '', permissions: [] };

export function RolesPage() {
  const { t } = useTranslation();
  const PERM_LABELS = permLabels(t);
  const [roles, setRoles]           = useState<Role[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editForm, setEditForm]     = useState<RoleFormState>(EMPTY_FORM);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<RoleFormState>(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getRoles();
      setRoles(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roles.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  /* v8 ignore start */
  function togglePerm(form: RoleFormState, perm: Permission): RoleFormState {
    const perms = form.permissions.includes(perm)
      ? form.permissions.filter(p => p !== perm)
      : [...form.permissions, perm];
    return { ...form, permissions: perms };
  }
  /* v8 ignore stop */

  function startEdit(role: Role) {
    setEditingId(role.id);
    setEditForm({ id: role.id, name: role.name, permissions: [...role.permissions] });
    setShowCreate(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  }

  async function submitEdit() {
    setSaving(true);
    setError('');
    try {
      const updated = await updateRole(editForm.id, { name: editForm.name, permissions: editForm.permissions });
      setRoles(rs => rs.map(r => r.id === updated.id ? updated : r));
      setEditingId(null);
      setEditForm(EMPTY_FORM);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roles.errors.updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function submitCreate() {
    setSaving(true);
    setError('');
    try {
      const created = await createRole(createForm);
      setRoles(rs => [...rs, created]);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roles.errors.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id: string) {
    setConfirmState({
      message: t('roles.deleteConfirm'),
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteRole(id);
          setRoles(rs => rs.filter(r => r.id !== id));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('roles.errors.deleteFailed'));
        }
      },
    });
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <>
      {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

      <div className="toolbar">
        <span className="toolbar-title">{t('roles.toolbarTitle')}</span>
        {!showCreate && (
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); setEditingId(null); }}>
            <Plus size={15} /> {t('roles.newRole')}
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <RoleForm
          form={createForm}
          onChange={setCreateForm}
          onSave={submitCreate}
          onCancel={() => { setShowCreate(false); setCreateForm(EMPTY_FORM); }}
          saving={saving}
          permLabels={PERM_LABELS}
          isNew
        />
      )}

      {/* Role list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {roles.map(role => (
          <div key={role.id} className="card" style={{ padding: 20 }}>
            {editingId === role.id ? (
              <RoleForm
                form={editForm}
                onChange={setEditForm}
                onSave={submitEdit}
                onCancel={cancelEdit}
                saving={saving}
                permLabels={PERM_LABELS}
              />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>{role.name}</span>
                    <code style={{ fontSize: '0.75rem', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 4 }}>
                      {role.id}
                    </code>
                    {role.builtin && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <Lock size={11} /> {t('roles.builtin')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {ALL_PERMISSIONS.map(perm => (
                      <span
                        key={perm}
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: role.permissions.includes(perm) ? 'var(--primary-light, rgba(99,102,241,0.15))' : 'var(--bg-secondary)',
                          color: role.permissions.includes(perm) ? 'var(--primary)' : 'var(--text-muted)',
                          opacity: role.permissions.includes(perm) ? 1 : 0.5,
                        }}
                      >
                        {PERM_LABELS[perm]}
                      </span>
                    ))}
                  </div>
                </div>
                {!role.builtin && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                      onClick={() => startEdit(role)}>
                      {t('roles.edit')}
                    </button>
                    <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                      onClick={() => handleDelete(role.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
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

interface RoleFormProps {
  form: RoleFormState;
  onChange: React.Dispatch<React.SetStateAction<RoleFormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  permLabels: Record<Permission, string>;
  isNew?: boolean;
}

function RoleForm({ form, onChange, onSave, onCancel, saving, permLabels, isNew }: RoleFormProps) {
  const { t } = useTranslation();

  function togglePerm(perm: Permission) {
    onChange(f => {
      const perms = f.permissions.includes(perm)
        ? f.permissions.filter(p => p !== perm)
        : [...f.permissions, perm];
      return { ...f, permissions: perms };
    });
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 12, border: '1px solid var(--primary)', borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {isNew && (
          <div className="form-group" style={{ flex: '0 0 180px', marginBottom: 0 }}>
            <label className="form-label">{t('roles.form.id')}</label>
            <input className="form-input" placeholder={t('roles.form.idPlaceholder')} value={form.id}
              onChange={e => onChange(f => ({ ...f, id: e.target.value }))} />
          </div>
        )}
        <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
          <label className="form-label">{t('roles.form.name')}</label>
          <input className="form-input" placeholder={t('roles.form.namePlaceholder')} value={form.name}
            onChange={e => onChange(f => ({ ...f, name: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="form-label" style={{ marginBottom: 8 }}>{t('roles.form.permissions')}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_PERMISSIONS.map(perm => (
            <label key={perm}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem',
                       padding: '4px 10px', borderRadius: 6,
                       background: form.permissions.includes(perm) ? 'var(--primary-light, rgba(99,102,241,0.15))' : 'var(--bg-secondary)',
                       border: form.permissions.includes(perm) ? '1px solid var(--primary)' : '1px solid var(--border)',
                     }}>
              <input type="checkbox" checked={form.permissions.includes(perm)}
                onChange={() => togglePerm(perm)} style={{ accentColor: 'var(--primary)' }} />
              {permLabels[perm]}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={saving} onClick={onSave}>
          {saving ? <span className="spinner" /> : <><Save size={14} /> {isNew ? t('roles.form.create') : t('roles.form.save')}</>}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          <X size={14} /> {t('roles.form.cancel')}
        </button>
      </div>
    </div>
  );
}
