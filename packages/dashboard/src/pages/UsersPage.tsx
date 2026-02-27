import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { getUsers, createUser, deleteUser, type User } from '../api';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', roleId: 'viewer' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setUsers(await getUsers()); } finally { setLoading(false); }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      await createUser(form);
      setShowModal(false);
      setForm({ email: '', password: '', roleId: 'viewer' });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user?')) return;
    await deleteUser(id);
    setUsers(u => u.filter(x => x.id !== id));
  }

  return (
    <>
      <div className="page-header">
        <h1>Users</h1>
        <p>Dashboard access management</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{users.length} user{users.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Add User
          </button>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : users.length === 0 ? (
          <div className="empty-state"><Users size={40} /><p>No users yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Projects</th><th></th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{u.email}</strong></td>
                    <td><span className={`badge ${u.roleId === 'admin' ? 'badge-success' : 'badge-ollama'}`}>{u.roleId}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {u.projectIds.length === 0 ? 'All' : u.projectIds.join(', ')}
                    </td>
                    <td>
                      <button className="btn-icon danger" onClick={() => handleDelete(u.id)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Add User</h2>
            <form onSubmit={handleAdd}>
              {err && <div className="form-error">{err}</div>}
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" required />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-input" value={form.roleId} onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))}>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
