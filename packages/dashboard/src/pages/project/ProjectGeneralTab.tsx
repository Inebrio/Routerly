import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { createProject, updateProject } from '../../api';
import { useProject } from './ProjectLayout';

export function ProjectGeneralTab() {
  const navigate = useNavigate();
  const { project, setProject } = useProject();
  const isEdit = Boolean(project);

  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState('');

  // For the new token reveal modal
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string; isNew: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: '',
    timeoutMs: '30000',
  });

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name,
        timeoutMs: String(project.timeoutMs ?? 30000),
      });
    }
  }, [project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        // If it's a new project, we have to provide dummy models to satisfy the API backend currently.
        // We will update the backend soon to make models optional, but for now:
        routingModelId: project?.routingModelId || 'gpt-4o',
        modelIds: project?.models.map(m => m.modelId) || ['gpt-4o'],
        timeoutMs: parseInt(form.timeoutMs),
      };

      if (isEdit && project) {
        await updateProject(project.id, payload);
        // show success briefly or just stay
        navigate(`/dashboard/projects/${project.id}/routing`); // Auto-advance maybe? Or stay.
        navigate('.', { replace: true }); // stay
      } else {
        const proj = await createProject(payload);
        if (proj.token) {
          setRevealedToken({ name: proj.name, token: proj.token, isNew: false });
        } else {
          navigate(`/dashboard/projects/${proj.id}/general`);
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

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">Project Name</label>
          <input
            className="form-input"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="My App"
            required
          />
        </div>

        {/* ── Advanced Settings ─────────────────────────── */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button type="button" onClick={() => setShowAdvanced(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 500, padding: '2px 0', userSelect: 'none' }}>
            <ChevronDown size={15} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
            Advanced settings
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label className="form-label">Global Timeout (ms)</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Maximum time an API request can take before LocalRouter aborts it.
                </p>
                <input
                  className="form-input"
                  type="number"
                  value={form.timeoutMs}
                  onChange={e => setForm(f => ({ ...f, timeoutMs: e.target.value }))}
                  min={1000}
                  max={300000}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 24 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </form>


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
                  if (!revealedToken.isNew && project) {
                    navigate(`/dashboard/projects/${project.id}/token`); // redirect to token tab to see it again if needed
                  } else if (!revealedToken.isNew) {
                    navigate('/dashboard/projects');
                  }
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
