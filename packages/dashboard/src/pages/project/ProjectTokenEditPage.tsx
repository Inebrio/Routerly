import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { updateProjectToken } from '../../api';
import { useProject } from './ProjectLayout';
import { LabelInput } from './ProjectTokenTab'; // Will be exported next

export function ProjectTokenEditPage() {
  const { id: projectId, tokenId } = useParams<{ id: string; tokenId: string }>();
  const navigate = useNavigate();
  const { project, setProject } = useProject();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Form state
  const [editModels, setEditModels] = useState<any[]>([]);
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [editLabelInput, setEditLabelInput] = useState('');

  const tokens = project?.tokens || [];
  const editingToken = tokens.find(t => t.id === tokenId);
  const allLabels = Array.from(new Set(tokens.flatMap(t => t.labels || []))).sort();

  // Initialize form state
  useEffect(() => {
    if (editingToken) {
      setEditModels(editingToken.models || []);
      setEditLabels(editingToken.labels || []);
    }
  }, [editingToken]);

  if (!project || !editingToken) return null;

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    if (!project || !projectId || !tokenId) return;
    try {
      const cleanedModels = editModels.map(m => {
        const t = { ...m.thresholds };
        if (isNaN(t.daily)) delete t.daily;
        if (isNaN(t.weekly)) delete t.weekly;
        if (isNaN(t.monthly)) delete t.monthly;
        return { modelId: m.modelId, thresholds: Object.keys(t).length > 0 ? t : undefined };
      });
      const updated = await updateProjectToken(projectId, tokenId, cleanedModels, editLabels);
      setProject(p => p ? { ...p, tokens: p.tokens?.map(t => t.id === tokenId ? updated : t) || [] } : p);
      navigate(`/dashboard/projects/${projectId}/token`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error saving token'); }
    finally { setLoading(false); }
  }

  function goBack() {
    navigate(`/dashboard/projects/${projectId}/token`);
  }

  return (
    <div className="page-body">
      <div style={{ maxWidth: 560 }}>


        <button type="button" onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: 0, marginBottom: 24 }}>
          <ArrowLeft size={16} /> Back to tokens
        </button>

        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 600 }}>Edit Token</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 28 }}>
          Update labels and per-model budget overrides for this token.
        </p>

        <form onSubmit={handleUpdate}>
          {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

          <div className="form-group">
            <label className="form-label">Token</label>
            <div className="form-input mono" style={{ opacity: 0.65, fontSize: '0.88rem', cursor: 'default', userSelect: 'text' }}>
              {editingToken.tokenSnippet}••••••••
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Labels <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <LabelInput labels={editLabels} setLabels={setEditLabels} input={editLabelInput} setInput={setEditLabelInput} allLabels={allLabels} />
          </div>

          <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
            <label className="form-label">Model Budget Overrides</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Override global and project-level budgets for requests using this token.
            </p>

            {(!project.models || project.models.length === 0) ? (
              <div style={{
                padding: 20, border: '1px dashed var(--border)',
                borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center',
              }}>
                Add target models in the Routing tab first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {project.models.map(pm => {
                  const override = editModels.find(m => m.modelId === pm.modelId);
                  const isEnabled = !!override;
                  return (
                    <div key={pm.modelId} style={{
                      border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
                      background: isEnabled ? 'var(--surface-active)' : 'transparent', transition: 'background 0.2s',
                    }}>
                      <label style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox" checked={isEnabled}
                          onChange={e => {
                            if (e.target.checked) setEditModels([...editModels, { modelId: pm.modelId, thresholds: {} }]);
                            else setEditModels(editModels.filter(m => m.modelId !== pm.modelId));
                          }}
                          style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        <span className="mono" style={{ fontSize: '0.85rem', color: isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {pm.modelId}
                        </span>
                      </label>
                      {isEnabled && (
                        <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                          {(['daily', 'weekly', 'monthly'] as const).map(period => (
                            <div key={period} className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: '0.75rem', textTransform: 'capitalize' }}>{period} ($)</label>
                              <input
                                type="number" step="0.01" min="0" className="form-input" placeholder="No limit"
                                value={override.thresholds?.[period] ?? ''}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  setEditModels(editModels.map(m =>
                                    m.modelId === pm.modelId
                                      ? { ...m, thresholds: { ...m.thresholds, [period]: isNaN(val) ? undefined : val } }
                                      : m
                                  ));
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Save Changes'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
