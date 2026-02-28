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

  // Create Mode State
  const [isCreating, setIsCreating] = useState(false);

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
      const result = await createProjectToken(project.id);
      setProject(p => {
        if (!p) return p;
        const tokens = p.tokens ? [...p.tokens] : [];
        tokens.push(result.tokenInfo);
        return { ...p, tokens };
      });
      setRevealedToken({ token: result.token });
      setIsCreating(false);
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

      const updated = await updateProjectToken(project.id, editingTokenId!, cleanedModels);
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

  // ─── Render: Edit View ───────────────────────────────────────────────────────
  if (editingToken) {
    return (
      <div style={{ maxWidth: 700, animation: 'fadeIn 0.2s ease-out' }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}
        {successMsg && <div className="form-success" style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', borderRadius: 6, border: '1px solid rgba(34, 197, 94, 0.2)' }}>{successMsg}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button className="btn-icon" onClick={() => { setEditingTokenId(null); setErr(''); setSuccessMsg(''); }} title="Back to tokens">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', color: 'var(--text-primary)' }}>Edit Token</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Configure token name and budget limits.
            </p>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" disabled={loading} onClick={handleUpdateToken}>
              {loading ? <span className="spinner" /> : <Save size={16} />}
              Save Changes
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div className="form-group">
            <label className="form-label">Token Prefix</label>
            <div className="mono form-input disabled" style={{ fontSize: '0.9rem', padding: '10px 12px', opacity: 0.8 }}>
              {editingToken.tokenSnippet}••••••••
            </div>
            <p className="form-help">For security reasons, full tokens cannot be viewed after creation.</p>
          </div>

          <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {project.models.map(pm => {
                  const override = editModels.find(m => m.modelId === pm.modelId);
                  const isEnabled = !!override;
                  return (
                    <div key={pm.modelId} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: isEnabled ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'all 0.2s' }}>
                      <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 500, color: isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            <span className="mono" style={{ fontSize: '0.85rem' }}>{pm.modelId}</span>
                          </div>
                        </div>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={e => {
                              if (e.target.checked) setEditModels([...editModels, { modelId: pm.modelId, thresholds: {} }]);
                              else setEditModels(editModels.filter(m => m.modelId !== pm.modelId));
                            }}
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>

                      {isEnabled && (
                        <div style={{ padding: '0 16px 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Daily budget USD <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
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
                            <label className="form-label">Weekly budget USD <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
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
                            <label className="form-label">Monthly budget USD <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
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
        </div>
      </div>
    );
  }

  // ─── Render: List View ───────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 800, animation: 'fadeIn 0.2s ease-out' }}>
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
        <form onSubmit={(e) => { e.preventDefault(); handleCreateToken(); }} className="card" style={{ padding: 20, marginBottom: 20, border: '1px solid var(--primary)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Create New Token</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Generate a new token for API authentication. For security reasons, the full token will only be shown once.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Create Token'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { setIsCreating(false); setErr(''); }} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
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
                        {token.models?.length ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>Has budget overrides</div>
                        ) : null}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {new Date(token.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                          <button
                            className="btn-icon"
                            onClick={() => { setEditingTokenId(token.id); setEditModels(token.models || []); setErr(''); setSuccessMsg(''); }}
                            disabled={loading}
                            title="Edit Budgets"
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

      {/* ─── Token Reveal Modal ─── */}
      {revealedToken && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease-out' }}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={20} color="#4ade80" /> Token Generated
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20, lineHeight: 1.5 }}>
              Your new token is ready. Please copy it below and store it securely. For security reasons, <strong>it will not be shown again</strong>.
            </p>

            <div className="form-group" style={{ marginBottom: 24 }}>
              <div style={{
                display: 'flex',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '12px',
                alignItems: 'center',
                gap: 12
              }}>
                <span className="mono" style={{ flex: 1, fontSize: '0.9rem', wordBreak: 'break-all', userSelect: 'all' }}>
                  {revealedToken.token}
                </span>
                <button
                  className="btn-icon"
                  style={{ background: copied ? 'rgba(74, 222, 128, 0.2)' : 'var(--border)', color: copied ? '#4ade80' : 'inherit' }}
                  onClick={() => copyToken(revealedToken.token)}
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="modal-footer" style={{ marginTop: 0 }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => { setRevealedToken(null); setCopied(false); }}
              >
                I have copied my token securely
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Ensure lucide icon is available for empty state
import { Key } from 'lucide-react';
