import React, { useEffect, useState } from 'react';
import { Plus, Trash2, FolderOpen, Copy, Check } from 'lucide-react';
import { getProjects, createProject, deleteProject, getModels, type Project, type Model } from '../api';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    name: '', routingModelId: '', modelIds: [] as string[], timeoutMs: '30000',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([getProjects(), getModels()]);
      setProjects(p); setModels(m);
      if (m.length > 0 && !form.routingModelId) setForm(f => ({ ...f, routingModelId: m[0]!.id }));
    } finally { setLoading(false); }
  }

  function toggleModel(id: string) {
    setForm(f => ({
      ...f, modelIds: f.modelIds.includes(id) ? f.modelIds.filter(x => x !== id) : [...f.modelIds, id],
    }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const proj = await createProject({
        name: form.name,
        routingModelId: form.routingModelId,
        modelIds: [...new Set([...form.modelIds, form.routingModelId])],
        timeoutMs: parseInt(form.timeoutMs),
      });
      setShowModal(false);
      setForm({ name: '', routingModelId: models[0]?.id ?? '', modelIds: [], timeoutMs: '30000' });
      if (proj.token) setNewToken({ name: proj.name, token: proj.token });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project?')) return;
    try {
      await deleteProject(id);
      setProjects(p => p.filter(x => x.id !== id));
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Error deleting project');
    }
  }

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="page-header">
        <h1>Projects</h1>
        <p>Client applications that access LocalRouter</p>
      </div>
      {err && <div className="form-error" style={{ margin: '0 20px' }}>{err}</div>}
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> New Project
          </button>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : projects.length === 0 ? (
          <div className="empty-state"><FolderOpen size={40} /><p>No projects yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Token Snippet</th><th>Routing Model</th><th>Models</th><th></th></tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{p.name}</strong></td>
                    <td>
                      <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {p.tokenSnippet ? `${p.tokenSnippet}...` : '••••••••••'}
                      </span>
                    </td>
                    <td><span className="mono" style={{ fontSize: '0.78rem' }}>{p.routingModelId}</span></td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {p.models.map(m => m.modelId).join(', ')}
                    </td>
                    <td>
                      <button className="btn-icon danger" onClick={() => handleDelete(p.id)} title="Delete project">
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

      {/* New project modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">New Project</h2>
            <form onSubmit={handleAdd}>
              {err && <div className="form-error">{err}</div>}
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Name</label>
                  <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="My App" required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Routing Model</label>
                <select className="form-input" value={form.routingModelId} onChange={e => setForm(f => ({ ...f, routingModelId: e.target.value }))} required>
                  {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Models (select all allowed)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {models.map(m => (
                    <button
                      key={m.id} type="button"
                      className={`btn btn-sm ${form.modelIds.includes(m.id) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => toggleModel(m.id)}
                    >{m.id}</button>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => {
                  setShowModal(false);
                  setForm({ name: '', routingModelId: models[0]?.id ?? '', modelIds: [], timeoutMs: '30000' });
                  setErr('');
                }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Token reveal modal */}
      {newToken && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">🎉 Project Created</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 16 }}>
              Project <strong style={{ color: 'var(--text-primary)' }}>{newToken.name}</strong> was created.
              Save this token — it won't be shown again.
            </p>
            <div className="token-box">{newToken.token}</div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => copyToken(newToken.token)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy Token'}
              </button>
              <button className="btn btn-primary" onClick={() => setNewToken(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
