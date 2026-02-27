import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Check, RefreshCw } from 'lucide-react';
import { createProject, updateProject, rotateToken, getProjects, getModels, type Model, type Project } from '../api';

export function ProjectFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [models, setModels] = useState<Model[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [err, setErr] = useState('');
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string; isNew: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: '',
    routingModelId: '',
    modelIds: [] as string[],
    timeoutMs: '30000',
  });

  useEffect(() => {
    async function loadData() {
      const [ms, ps] = await Promise.all([getModels(), getProjects()]);
      setModels(ms);
      if (isEdit && id) {
        const proj = ps.find(p => p.id === id);
        if (proj) {
          setProject(proj);
          setForm({
            name: proj.name,
            routingModelId: proj.routingModelId,
            modelIds: proj.models.map(m => m.modelId),
            timeoutMs: String(proj.timeoutMs ?? 30000),
          });
        }
      } else if (ms.length > 0) {
        setForm(f => ({ ...f, routingModelId: ms[0]!.id }));
      }
      setLoading(false);
    }
    loadData();
  }, [id, isEdit]);

  function toggleModel(modelId: string) {
    setForm(f => ({
      ...f,
      modelIds: f.modelIds.includes(modelId)
        ? f.modelIds.filter(x => x !== modelId)
        : [...f.modelIds, modelId],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        routingModelId: form.routingModelId,
        modelIds: [...new Set([...form.modelIds, form.routingModelId])],
        timeoutMs: parseInt(form.timeoutMs),
      };
      if (isEdit && id) {
        await updateProject(id, payload);
        navigate('/dashboard/projects');
      } else {
        const proj = await createProject(payload);
        if (proj.token) {
          setRevealedToken({ name: proj.name, token: proj.token, isNew: false });
        } else {
          navigate('/dashboard/projects');
        }
      }
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Error saving project');
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateToken() {
    if (!id) return;
    if (!confirm('This will immediately revoke the current token. Any application using it will stop working until updated. Continue?')) return;
    setErr('');
    setRotating(true);
    try {
      const result = await rotateToken(id);
      setProject(p => p ? { ...p, tokenSnippet: result.tokenSnippet ?? '' } : p);
      setRevealedToken({ name: result.name, token: result.token, isNew: true });
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Error rotating token');
    } finally {
      setRotating(false);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" onClick={() => navigate('/dashboard/projects')} title="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>{isEdit ? 'Edit Project' : 'New Project'}</h1>
            <p>{isEdit ? 'Update project configuration' : 'Create a new client application that can access LocalRouter'}</p>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 640 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="My App"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Routing Model</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  The model used to decide which backend model to route each request to.
                </p>
                <select
                  className="form-input"
                  value={form.routingModelId}
                  onChange={e => setForm(f => ({ ...f, routingModelId: e.target.value }))}
                  required
                >
                  {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Allowed Models</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Select which models this project can use. The routing model is always included.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {models.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className={`btn btn-sm ${form.modelIds.includes(m.id) || m.id === form.routingModelId ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => toggleModel(m.id)}
                      disabled={m.id === form.routingModelId}
                    >
                      {m.id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Timeout (ms)</label>
                <input
                  className="form-input"
                  type="number"
                  value={form.timeoutMs}
                  onChange={e => setForm(f => ({ ...f, timeoutMs: e.target.value }))}
                  min={1000}
                  max={300000}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard/projects')}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Create Project'}
                </button>
              </div>
            </form>

            {/* Token section — only in edit mode */}
            {isEdit && project && (
              <div style={{
                marginTop: 32,
                paddingTop: 24,
                borderTop: '1px solid var(--border)',
              }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: 'var(--text-primary)' }}>API Token</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                  Rotating the token immediately revokes the current one.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="mono" style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
                    {project.tokenSnippet ? `${project.tokenSnippet}...` : '••••••••••'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleRotateToken}
                    disabled={rotating}
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  >
                    {rotating ? <span className="spinner" /> : <RefreshCw size={14} />}
                    Rotate Token
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Token reveal modal */}
      {revealedToken && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">
              {revealedToken.isNew ? '🔑 New Token' : '🎉 Project Created'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 12 }}>
              Copy this token now — it won't be shown again.
            </p>
            <div className="token-box" style={{ marginBottom: 12 }}>{revealedToken.token}</div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => copyToken(revealedToken.token)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy Token'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setRevealedToken(null);
                  if (!revealedToken.isNew) navigate('/dashboard/projects');
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
