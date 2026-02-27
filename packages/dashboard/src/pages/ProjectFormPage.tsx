import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import { createProject, updateProject, getProjects, getModels, type Model } from '../api';

export function ProjectFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);
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
          setNewToken({ name: proj.name, token: proj.token });
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

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (newToken) {
    return (
      <>
        <div className="page-header">
          <h1>🎉 Project Created</h1>
          <p>Save this token now — it won't be shown again.</p>
        </div>
        <div className="page-body" style={{ maxWidth: 640 }}>
          <div className="form-group">
            <label className="form-label">Project</label>
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '1rem' }}>
              {newToken.name}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">API Token</label>
            <div className="token-box">{newToken.token}</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 8 }}>
              Use this as the Bearer token in your API requests. It won't be shown again.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={() => copyToken(newToken.token)}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied!' : 'Copy Token'}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/dashboard/projects')}>
              Done
            </button>
          </div>
        </div>
      </>
    );
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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/dashboard/projects')}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Create Project'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
