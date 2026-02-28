import React, { useState } from 'react';
import { Copy, Check, Plus, Trash2, Edit2, ArrowLeft, Save } from 'lucide-react';
import { createProjectToken, updateProjectToken, deleteProjectToken, type ProjectToken } from '../../api';
import { useProject } from './ProjectLayout';

export function ProjectTokenTab() {
  const { project, setProject } = useProject();
  if (!project) return null;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit Mode State
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [editModels, setEditModels] = useState<any[]>([]);
  const [editLabels, setEditLabels] = useState<string[]>([]);

  // Create Mode State
  const [isCreating, setIsCreating] = useState(false);
  const [createLabels, setCreateLabels] = useState<string[]>([]);

  // Modal State
  const [revealedToken, setRevealedToken] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const showError = (e: unknown, defaultMsg: string) => {
    setErr(e instanceof Error ? e.message : defaultMsg);
  };

  const handleCreateToken = async () => {
    setErr('');
    setLoading(true);
    try {
      const result = await createProjectToken(project.id, createLabels);
      setProject(p => {
        if (!p) return p;
        const tokens = p.tokens ? [...p.tokens] : [];
        tokens.push(result.tokenInfo);
        return { ...p, tokens };
      });
      setRevealedToken({ token: result.token });
      setIsCreating(false);
      setCreateLabels([]);
      showSuccess('Token created successfully.');
    } catch (e) {
      showError(e, 'Error creating token');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteToken = async (tokenId: string, prefix: string) => {
    if (!window.confirm(`Are you sure you want to delete token starting with "${prefix}"? Applications using it will immediately stop working.`)) return;
    setErr('');
    setLoading(true);
    try {
      await deleteProjectToken(project.id, tokenId);
      setProject(p => {
        if (!p) return p;
        return { ...p, tokens: p.tokens?.filter(t => t.id !== tokenId) || [] };
      });
      if (editingTokenId === tokenId) setEditingTokenId(null);
      showSuccess('Token deleted.');
    } catch (e) {
      showError(e, 'Error deleting token');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateToken = async () => {
    setErr('');
    setLoading(true);
    try {
      // Filter out empty threshold values to keep data clean
      const cleanedModels = editModels.map(m => {
        const t = { ...m.thresholds };
        if (t.daily === undefined || isNaN(t.daily)) delete t.daily;
        if (t.weekly === undefined || isNaN(t.weekly)) delete t.weekly;
        if (t.monthly === undefined || isNaN(t.monthly)) delete t.monthly;
        return { modelId: m.modelId, thresholds: Object.keys(t).length > 0 ? t : undefined };
      });

      const updated = await updateProjectToken(project.id, editingTokenId!, cleanedModels, editLabels);
      setProject(p => {
        if (!p) return p;
        const tokens = p.tokens?.map(t => t.id === editingTokenId ? updated : t) || [];
        return { ...p, tokens };
      });
      showSuccess('Token overrides saved.');
      // Optional: don't close, let them keep editing
      // setEditingTokenId(null);
    } catch (e) {
      showError(e, 'Error updating token');
    } finally {
      setLoading(false);
    }
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setErr('Failed to copy to clipboard.');
    }
  };

  const tokens = project.tokens || [];
  const editingToken = tokens.find(t => t.id === editingTokenId);
  const allLabels = Array.from(new Set(tokens.flatMap(t => t.labels || []))).sort();



  // ─── Render: List View ───────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 800, animation: 'fadeIn 0.2s ease-out' }}>
      <datalist id="all-labels">{allLabels.map(l => <option key={l} value={l} />)}</datalist>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}
      {successMsg && <div className="form-success" style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', borderRadius: 6, border: '1px solid rgba(34, 197, 94, 0.2)' }}>{successMsg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: 'var(--text-primary)' }}>API Tokens</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            Manage authentication tokens for programmatic access to this project.
          </p>
        </div>
        {!isCreating && (
          <button type="button" className="btn btn-primary" onClick={() => setIsCreating(true)} disabled={loading}>
            <Plus size={16} /> New Token
          </button>
        )}
      </div>

      {isCreating && (
        <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px dashed var(--border)', background: 'var(--surface-active)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Add New Token</h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Generate a new token for API authentication. The full token will only be shown once.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); handleCreateToken(); }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px', background: 'var(--bg-default)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 40, alignItems: 'center' }}>
                  {createLabels.map(label => (
                    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-active)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem' }}>
                      {label}
                      <button type="button" onClick={() => setCreateLabels(createLabels.filter(l => l !== label))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}>
                        &times;
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="Add label (optional)..."
                    list="all-labels"
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        const val = (e.currentTarget.value || '').trim();
                        if (val && !createLabels.includes(val)) {
                          setCreateLabels([...createLabels, val]);
                        }
                        e.currentTarget.value = '';
                      }
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', flex: 1, minWidth: 120, fontSize: '0.85rem' }}
                  />
                </div>
                <p className="form-help" style={{ marginTop: 6, fontSize: '0.75rem' }}>Press Enter or comma to add a label.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? <span className="spinner" /> : 'Create'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setIsCreating(false); setErr(''); setCreateLabels([]); }} disabled={loading}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {tokens.length === 0 && !isCreating ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Key size={32} style={{ opacity: 0.5, marginBottom: 12 }} />
          <div>No API tokens found.</div>
          <div style={{ fontSize: '0.85rem', marginTop: 4 }}>Create one to start authenticating requests.</div>
        </div>
      ) : (
        tokens.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Prefix</th>
                  <th>Created</th>
                  <th style={{ width: 100, textAlign: 'right', paddingRight: 20 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token: ProjectToken) => {
                  return (
                    <tr key={token.id}>
                      <td style={{ paddingLeft: 20 }}>
                        <div style={{ display: 'inline-flex', padding: '4px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid var(--border)' }}>
                          <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{token.tokenSnippet}••••••••</span>
                        </div>
                        {token.labels && token.labels.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                            {token.labels.map(l => (
                              <span key={l} style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{l}</span>
                            ))}
                          </div>
                        )}
                        {token.models?.length ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Has budget overrides</div>
                        ) : null}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {new Date(token.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                          <button
                            className="btn-icon"
                            onClick={() => { setEditingTokenId(token.id); setEditModels(token.models || []); setEditLabels(token.labels || []); setErr(''); setSuccessMsg(''); }}
                            disabled={loading}
                            title="Edit Token Details"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleDeleteToken(token.id, token.tokenSnippet || '')}
                            disabled={loading}
                            title="Revoke Token"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ─── Token Edit Modal ─── */}
      {editingToken && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditingTokenId(null)}>
          <div className="modal" style={{ maxWidth: 650, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Edit Token</h2>
              <button className="btn-icon" onClick={() => setEditingTokenId(null)}><X size={20} /></button>
            </div>

            {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}
            {successMsg && <div className="form-success" style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', borderRadius: 6, border: '1px solid rgba(34, 197, 94, 0.2)' }}>{successMsg}</div>}

            <div className="form-group">
              <label className="form-label">Token Prefix</label>
              <div className="mono form-input disabled" style={{ fontSize: '0.9rem', padding: '10px 12px', opacity: 0.8, background: 'var(--surface-active)' }}>
                {editingToken.tokenSnippet}••••••••
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 20 }}>
              <label className="form-label">Labels / Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px', background: 'var(--bg-default)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 40, alignItems: 'center' }}>
                {editLabels.map(label => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-active)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem' }}>
                    {label}
                    <button type="button" onClick={() => setEditLabels(editLabels.filter(l => l !== label))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      &times;
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="Add label (optional)..."
                  list="all-labels"
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = (e.currentTarget.value || '').trim();
                      if (val && !editLabels.includes(val)) {
                        setEditLabels([...editLabels, val]);
                      }
                      e.currentTarget.value = '';
                    }
                  }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', flex: 1, minWidth: 120, fontSize: '0.85rem' }}
                />
              </div>
            </div>

            <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem' }}>Model Budget Overrides</h4>
                <p className="form-help" style={{ margin: 0 }}>
                  Limits set here override global and project-level budgets for requests authenticated with this token.
                </p>
              </div>

              {(!project.models || project.models.length === 0) ? (
                <div style={{ padding: '24px', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                  Add API models to your project first to configure per-model token overrides.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {project.models.map(pm => {
                    const override = editModels.find(m => m.modelId === pm.modelId);
                    const isEnabled = !!override;
                    return (
                      <div key={pm.modelId} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: isEnabled ? 'var(--surface-active)' : 'transparent', transition: 'all 0.2s' }}>
                        <label style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={e => {
                              if (e.target.checked) setEditModels([...editModels, { modelId: pm.modelId, thresholds: {} }]);
                              else setEditModels(editModels.filter(m => m.modelId !== pm.modelId));
                            }}
                            style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
                          />
                          <div style={{ fontWeight: 500, color: isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1 }}>
                            <span className="mono" style={{ fontSize: '0.85rem' }}>{pm.modelId}</span>
                          </div>
                        </label>

                        {isEnabled && (
                          <div style={{ padding: '0 16px 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: '0.75rem' }}>Daily budget ($)</label>
                              <input type="number" step="0.01" min="0" className="form-input" placeholder="No limit"
                                value={override.thresholds?.daily ?? ''}
                                onChange={e => {
                                  let val: number | undefined = parseFloat(e.target.value);
                                  if (isNaN(val)) val = undefined;
                                  setEditModels(editModels.map(m => m.modelId === pm.modelId ? { ...m, thresholds: { ...m.thresholds, daily: val } } : m));
                                }}
                              />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: '0.75rem' }}>Weekly budget ($)</label>
                              <input type="number" step="0.01" min="0" className="form-input" placeholder="No limit"
                                value={override.thresholds?.weekly ?? ''}
                                onChange={e => {
                                  let val: number | undefined = parseFloat(e.target.value);
                                  if (isNaN(val)) val = undefined;
                                  setEditModels(editModels.map(m => m.modelId === pm.modelId ? { ...m, thresholds: { ...m.thresholds, weekly: val } } : m));
                                }}
                              />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: '0.75rem' }}>Monthly budget ($)</label>
                              <input type="number" step="0.01" min="0" className="form-input" placeholder="No limit"
                                value={override.thresholds?.monthly ?? ''}
                                onChange={e => {
                                  let val: number | undefined = parseFloat(e.target.value);
                                  if (isNaN(val)) val = undefined;
                                  setEditModels(editModels.map(m => m.modelId === pm.modelId ? { ...m, thresholds: { ...m.thresholds, monthly: val } } : m));
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => { setEditingTokenId(null); setErr(''); setSuccessMsg(''); }} disabled={loading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpdateToken} disabled={loading}>
                {loading ? <span className="spinner" /> : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Ensure lucide icon is available for empty state
import { Key, X } from 'lucide-react';
