import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { useProject } from './ProjectLayout';
import { getUsers, addProjectMember, updateProjectMember, removeProjectMember, User } from '../../api';

export function ProjectUsersTab() {
  const { project, setProject } = useProject();
  if (!project) return null;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('viewer');

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('viewer');

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load users'));
  }, []);

  async function handleAddMember() {
    if (!newUserId) return;
    setErr('');
    setLoading(true);
    try {
      const member = await addProjectMember(project!.id, newUserId, newRole);
      setProject(p => {
        if (!p) return p;
        const members = p.members ? [...p.members] : [];
        members.push(member);
        return { ...p, members };
      });
      setAdding(false);
      setNewUserId('');
      setNewRole('viewer');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error adding member');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateMember(userId: string) {
    setErr('');
    setLoading(true);
    try {
      const updated = await updateProjectMember(project!.id, userId, editRole);
      setProject(p => {
        if (!p) return p;
        const members = p.members?.map(m => m.userId === userId ? updated : m) || [];
        return { ...p, members };
      });
      setEditingUserId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error updating member');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!window.confirm('Are you sure you want to remove this member?')) return;
    setErr('');
    setLoading(true);
    try {
      await removeProjectMember(project!.id, userId);
      setProject(p => {
        if (!p) return p;
        return { ...p, members: p.members?.filter(m => m.userId !== userId) || [] };
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error removing member');
    } finally {
      setLoading(false);
    }
  }

  const members = project.members || [];
  const availableUsers = users.filter(u => !members.find(m => m.userId === u.id));

  return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: 'var(--text-primary)' }}>Project Members</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            Manage users who have access to this project.
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} disabled={loading}>
            <Plus size={16} />
            Add Member
          </button>
        )}
      </div>

      {adding && (
        <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px dashed var(--border)', background: 'var(--surface-active)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Add New Member</h4>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <select className="form-input" value={newUserId} onChange={e => setNewUserId(e.target.value)} disabled={loading}>
                <option value="" disabled>Select a user...</option>
                {availableUsers.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </div>
            <div style={{ width: 140 }}>
              <select className="form-input" value={newRole} onChange={e => setNewRole(e.target.value)} disabled={loading}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleAddMember} disabled={loading || !newUserId}>Add</button>
              <button className="btn btn-secondary" onClick={() => setAdding(false)} disabled={loading}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {members.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          No members found.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th style={{ width: 200 }}>Role</th>
                <th style={{ width: 100, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map(member => {
                const user = users.find(u => u.id === member.userId);
                const isEditing = editingUserId === member.userId;

                return (
                  <tr key={member.userId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {user?.email || <span style={{ color: 'var(--text-muted)' }}>{member.userId}</span>}
                      </div>
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          className="form-input"
                          value={editRole}
                          onChange={e => setEditRole(e.target.value)}
                          disabled={loading}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
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
                    <td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      {isEditing ? (
                        <>
                          <button className="btn-icon" onClick={() => handleUpdateMember(member.userId)} disabled={loading} title="Save changes">
                            <Check size={16} />
                          </button>
                          <button className="btn-icon" onClick={() => setEditingUserId(null)} disabled={loading} title="Cancel">
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn-icon"
                            onClick={() => { setEditingUserId(member.userId); setEditRole(member.role); }}
                            disabled={loading}
                            title="Change Role"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleRemoveMember(member.userId)}
                            disabled={loading}
                            title="Remove Member"
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
    </div>
  );
}
