import React, { useEffect, useState } from 'react';
import { updateProject, getModels, type Model } from '../../api';
import { useProject } from './ProjectLayout';

export function ProjectRoutingTab() {
  const { project, setProject } = useProject();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [form, setForm] = useState({
    routingModelId: '',
    modelIds: [] as string[],
  });

  useEffect(() => {
    getModels()
      .then(m => setModels(m))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (project) {
      setForm({
        routingModelId: project.routingModelId,
        modelIds: project.models.map(m => m.modelId),
      });
    }
  }, [project]);

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
    if (!project) return;
    setErr('');
    setSaving(true);
    try {
      const payload = {
        name: project.name,
        routingModelId: form.routingModelId,
        modelIds: [...new Set([...form.modelIds, form.routingModelId])],
        ...(project.timeoutMs !== undefined && { timeoutMs: project.timeoutMs }),
      };
      const updated = await updateProject(project.id, payload);
      setProject(updated);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Error saving project routing');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

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

      <div className="form-group" style={{ marginTop: 24 }}>
        <label className="form-label">Allowed Models</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          Select which models this project can use. The routing model is always included automatically.
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

      <div style={{ marginTop: 32 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <span className="spinner" /> : 'Save Routing Configuration'}
        </button>
      </div>
    </form>
  );
}
