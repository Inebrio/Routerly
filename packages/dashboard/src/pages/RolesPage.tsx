import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Lock, Save, X } from 'lucide-react';
import { getRoles, createRole, updateRole, deleteRole, ALL_PERMISSIONS } from '../api';
import type { Role, Permission } from '../api';

const PERM_LABELS: Record<Permission, string> = {
  'project:read':  'Projects – Read',
  'project:write': 'Projects – Write',
  'model:read':    'Models – Read',
  'model:write':   'Models – Write',
  'user:read':     'Users – Read',
  'user:write':    'Users – Write',
  'report:read':   'Reports – Read',
};

interface RoleFormState {
  id: string;
  name: string;
  permissions: Permission[];
}

const EMPTY_FORM: RoleFormState = { id: '', name: '', permissions: [] };

export function RolesPage() {
  const [roles, setRoles]           = useState<Role[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editForm, setEditForm]     = useState<RoleFormState>(EMPTY_FORM);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<RoleFormState>(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getRoles();
      setRoles(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  function togglePerm(form: RoleFormState, perm: Permission): RoleFormState {
    const perms = form.permissions.includes(perm)
      ? form.permissions.filter(p => p !== perm)
      : [...form.permissions, perm];
    return { ...form, permissions: perms };
  }

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
      setError(e instanceof Error ? e.message : 'Failed to update role');
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
      setError(e instanceof Error ? e.message : 'Failed to create role');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this role? Users with this role will be affected.')) return;
    setError('');
    try {
      await deleteRole(id);
      setRoles(rs => rs.filter(r => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete role');
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <>
      {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0 }}>Roles</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Manage roles and their permissions. Built-in roles cannot be modified.
          </p>
        </div>
        {!showCreate && (
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); setEditingId(null); }}>
            <Plus size={15} /> New Role
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
                        <Lock size={11} /> built-in
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
                      Edit
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
    </>
  );
}

interface RoleFormProps {
  form: RoleFormState;
  onChange: React.Dispatch<React.SetStateAction<RoleFormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew?: boolean;
}

function RoleForm({ form, onChange, onSave, onCancel, saving, isNew }: RoleFormProps) {
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
            <label className="form-label">ID</label>
            <input className="form-input" placeholder="e.g. operator" value={form.id}
              onChange={e => onChange(f => ({ ...f, id: e.target.value }))} />
          </div>
        )}
        <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
          <label className="form-label">Name</label>
          <input className="form-input" placeholder="Role name" value={form.name}
            onChange={e => onChange(f => ({ ...f, name: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="form-label" style={{ marginBottom: 8 }}>Permissions</label>
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
              {PERM_LABELS[perm]}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={saving} onClick={onSave}>
          {saving ? <span className="spinner" /> : <><Save size={14} /> {isNew ? 'Create' : 'Save'}</>}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}
