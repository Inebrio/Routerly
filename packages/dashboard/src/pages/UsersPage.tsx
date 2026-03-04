import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Users, Pencil } from 'lucide-react';
import { getUsers, createUser, deleteUser, type User } from '../api';

type AddForm = { email: string; password: string; roleId: string };

export function UsersPage() {
  const [users, setUsers]         = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [addForm, setAddForm]     = useState<AddForm>({ email: '', password: '', roleId: 'viewer' });
  const [addErr, setAddErr]       = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setUsers(await getUsers()); } finally { setLoading(false); }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddErr(''); setAddSaving(true);
    try {
      await createUser(addForm);
      setShowAdd(false);
      setAddForm({ email: '', password: '', roleId: 'viewer' });
      await load();
    } catch (e) { setAddErr(e instanceof Error ? e.message : 'Error'); }
    finally { setAddSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user?')) return;
    await deleteUser(id);
    setUsers(u => u.filter(x => x.id !== id));
  }

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">{users.length} user{users.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
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
                  <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn-icon" onClick={() => navigate(`/dashboard/settings/users/${u.id}`)}>
                      <Pencil size={14} />
                    </button>
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

      {/* ── Add modal ── */}
      {showAdd && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal">
            <h2 className="modal-title">Add User</h2>
            <form onSubmit={handleAdd}>
              {addErr && <div className="form-error">{addErr}</div>}
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={addForm.password}
                  onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" required />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-input" value={addForm.roleId} onChange={e => setAddForm(f => ({ ...f, roleId: e.target.value }))}>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={addSaving}>
                  {addSaving ? <span className="spinner" /> : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


    </>
  );
}
