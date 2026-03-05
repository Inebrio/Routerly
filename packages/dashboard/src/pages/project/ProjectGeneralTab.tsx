import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Copy, Check, ChevronDown, ArrowRight, Plug } from 'lucide-react';
import { createProject, updateProject, getSettings } from '../../api';
import { useProject } from './ProjectLayout';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';

export function ProjectGeneralTab() {
  const navigate = useNavigate();
  const { project, setProject } = useProject();
  const isEdit = Boolean(project);

  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState('');
  const [servicePublicUrl, setServicePublicUrl] = useState<string>('');

  // Fetch publicUrl from settings once so "How to connect" shows the correct endpoint
  // even when the dashboard is served from a different host/port than the service.
  useEffect(() => {
    getSettings().then(s => {
      const url = s.publicUrl?.replace(/\/$/, '') ||
        `${window.location.protocol}//${window.location.hostname}:${s.port}`;
      setServicePublicUrl(url);
    }).catch(() => {});
  }, []);

  // For the new token reveal modal
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string; isNew: boolean; projectId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

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

  const isDirty = isEdit
    ? form.name !== (project?.name ?? '') || form.timeoutMs !== String(project?.timeoutMs ?? 30000)
    : form.name !== '';

  // Once the token is revealed the form is "done" — don't block navigation anymore.
  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty && !revealedToken);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = isEdit
        ? {
            name: form.name,
            routingModelId: project!.routingModelId || 'gpt-4o',
            models: project!.models.map(m => ({ modelId: m.modelId })),
            timeoutMs: parseInt(form.timeoutMs),
          }
        : {
            name: form.name,
            models: [],
            timeoutMs: parseInt(form.timeoutMs),
          };

      if (isEdit && project) {
        await updateProject(project.id, payload);
        // Sync context so isDirty becomes false before navigating (avoids blocker)
        setProject({ ...project, name: form.name, timeoutMs: parseInt(form.timeoutMs) });
        navigate('.', { replace: true }); // stay
      } else {
        const proj = await createProject(payload);
        if (proj.token) {
          setRevealedToken({ name: proj.name, token: proj.token, isNew: false, projectId: proj.id });
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

  async function copyEndpoint(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedEndpoint(value);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  }

  // ── Token reveal view (after project creation) ───────────────────────────────
  if (revealedToken) {
    return (
      <div style={{ maxWidth: 480 }}>
        {/* Warning */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16, background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)', borderRadius: 8 }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>
            <strong>Save this token now.</strong> It won't be shown again — once you leave this screen it cannot be recovered.
          </p>
        </div>

        {/* Token box */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.8rem', minWidth: 0 }}>
            {revealedToken.token}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => copyToken(revealedToken.token)} style={{ flexShrink: 0 }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => navigate(`/dashboard/projects/${revealedToken.projectId}/general`)}
        >
          Go to project <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ── Connection info (only when editing an existing project) ────────────── */}
      {isEdit && project && (() => {
        // Use admin-configured publicUrl (Settings → Public URL).
        // Falls back to window.location.origin while the fetch is in flight or if unset.
        const baseUrl = (servicePublicUrl || window.location.origin) + '/v1';
        return (
          <div style={{ marginBottom: 28, padding: '12px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Plug size={14} style={{ color: 'var(--color-primary, #6366f1)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>How to connect</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
              Use this endpoint as <code style={{ fontSize: '0.75rem' }}>base_url</code> with the OpenAI SDK or Anthropic SDK —
              both use the same <code style={{ fontSize: '0.75rem' }}>/v1</code> prefix; the final path is appended automatically by the SDK.
              Use a <Link to={`/dashboard/projects/${project.id}/tokens`} style={{ color: 'var(--color-primary, #6366f1)' }}>project token</Link> as the API key.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-input, var(--bg-tertiary, var(--bg-secondary)))', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-primary)', minWidth: 0 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseUrl}</span>
              </div>
              <button
                type="button"
                onClick={() => copyEndpoint(baseUrl)}
                className="btn btn-secondary"
                style={{ flexShrink: 0, padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {copiedEndpoint === baseUrl ? <Check size={13} /> : <Copy size={13} />}
                {copiedEndpoint === baseUrl ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        );
      })()}

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
          <button type="submit" className="btn btn-primary" disabled={saving || (isEdit && !isDirty)}>
            {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
