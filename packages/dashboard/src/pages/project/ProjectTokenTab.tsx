import React, { useState } from 'react';
import { Copy, Check, Plus, Trash2, Edit2, ArrowLeft, Key } from 'lucide-react';
import { createProjectToken, updateProjectToken, deleteProjectToken, type ProjectToken } from '../../api';
import { useProject } from './ProjectLayout';

type View = 'list' | 'create' | 'edit';

export function ProjectTokenTab() {
  const { project, setProject } = useProject();
  if (!project) return null;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>('list');
  const [copied, setCopied] = useState(false);

  // Create state
  const [createLabels, setCreateLabels] = useState<string[]>([]);
  const [createLabelInput, setCreateLabelInput] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  // Edit state
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [editModels, setEditModels] = useState<any[]>([]);
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [editLabelInput, setEditLabelInput] = useState('');

  const tokens = project.tokens || [];
  const editingToken = tokens.find(t => t.id === editingTokenId);
  const allLabels = Array.from(new Set(tokens.flatMap(t => t.labels || []))).sort();

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function openCreate() {
    setCreateLabels([]); setCreateLabelInput(''); setRevealedToken(null); setErr('');
    setView('create');
  }

  function openEdit(token: ProjectToken) {
    setEditingTokenId(token.id);
    setEditModels(token.models || []);
    setEditLabels(token.labels || []);
    setEditLabelInput(''); setErr('');
    setView('edit');
  }

  function goBack() {
    setView('list'); setEditingTokenId(null); setRevealedToken(null); setErr('');
  }

  function addLabel(
    raw: string,
    labels: string[], setLabels: (l: string[]) => void,
    setInput: (v: string) => void,
  ) {
    const val = raw.trim();
    if (val && !labels.includes(val)) setLabels([...labels, val]);
    setInput('');
  }

  async function copyToClipboard(token: string) {
    try { await navigator.clipboard.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setErr('Failed to copy to clipboard.'); }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const result = await createProjectToken(project.id, createLabels);
      setProject(p => p ? { ...p, tokens: [...(p.tokens || []), result.tokenInfo] } : p);
      setRevealedToken(result.token);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error creating token'); }
    finally { setLoading(false); }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const cleanedModels = editModels.map(m => {
        const t = { ...m.thresholds };
        if (isNaN(t.daily)) delete t.daily;
        if (isNaN(t.weekly)) delete t.weekly;
        if (isNaN(t.monthly)) delete t.monthly;
        return { modelId: m.modelId, thresholds: Object.keys(t).length > 0 ? t : undefined };
      });
      const updated = await updateProjectToken(project.id, editingTokenId!, cleanedModels, editLabels);
      setProject(p => p ? { ...p, tokens: p.tokens?.map(t => t.id === editingTokenId ? updated : t) || [] } : p);
      goBack();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error saving token'); }
    finally { setLoading(false); }
  }

  async function handleDelete(tokenId: string, snippet: string) {
    if (!window.confirm(`Revoke token "${snippet}…"? Apps using it will stop working immediately.`)) return;
    setErr(''); setLoading(true);
    try {
      await deleteProjectToken(project.id, tokenId);
      setProject(p => p ? { ...p, tokens: p.tokens?.filter(t => t.id !== tokenId) || [] } : p);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error deleting token'); }
    finally { setLoading(false); }
  }

  // ── Shared: label input widget ─────────────────────────────────────────────────

  function LabelInput({ labels, setLabels, input, setInput }: {
    labels: string[]; setLabels: (l: string[]) => void;
    input: string; setInput: (v: string) => void;
  }) {
    return (
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 6, minHeight: 42, alignItems: 'center',
      }}>
        {labels.map(label => (
          <span key={label} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--surface-active)', border: '1px solid var(--border)',
            padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem',
          }}>
            {label}
            <button type="button" onClick={() => setLabels(labels.filter(l => l !== label))}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', lineHeight: 1 }}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text" list="all-labels" value={input}
          placeholder={labels.length === 0 ? 'Type and press Enter to add…' : ''}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addLabel(input, labels, setLabels, setInput);
            }
          }}
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-primary)',
            outline: 'none', flex: 1, minWidth: 140, fontSize: '0.85rem', padding: 0,
          }}
        />
      </div>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <div style={{ maxWidth: 720 }}>
        <datalist id="all-labels">{allLabels.map(l => <option key={l} value={l} />)}</datalist>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="toolbar" style={{ marginBottom: 24 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
            API tokens authenticate programmatic requests to this project.
          </p>
          <button className="btn btn-primary" onClick={openCreate} disabled={loading}>
            <Plus size={16} /> New Token
          </button>
        </div>

        {tokens.length === 0 ? (
          <div className="empty-state">
            <Key size={36} />
            <p>No API tokens yet. Create one to start authenticating requests.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(token => (
                  <tr key={token.id}>
                    <td>
                      <span className="mono" style={{ fontSize: '0.85rem' }}>{token.tokenSnippet}••••••••</span>
                      {token.labels?.length ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {token.labels.map(l => (
                            <span key={l} style={{
                              background: 'rgba(255,255,255,0.06)', padding: '2px 8px',
                              borderRadius: 4, fontSize: '0.72rem', color: 'var(--text-secondary)',
                            }}>{l}</span>
                          ))}
                        </div>
                      ) : null}
                      {token.models?.length ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Has budget overrides</div>
                      ) : null}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                      {new Date(token.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn-icon" onClick={() => openEdit(token)} disabled={loading} title="Edit">
                        <Edit2 size={15} />
                      </button>
                      <button className="btn-icon danger" onClick={() => handleDelete(token.id, token.tokenSnippet || '')} disabled={loading} title="Revoke">
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
    );
  }

  // ── CREATE VIEW ───────────────────────────────────────────────────────────────

  if (view === 'create') {
    return (
      <div style={{ maxWidth: 560 }}>
        <datalist id="all-labels">{allLabels.map(l => <option key={l} value={l} />)}</datalist>

        <button type="button" onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: 0, marginBottom: 24 }}>
          <ArrowLeft size={16} /> Back to tokens
        </button>

        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 600 }}>New API Token</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 28 }}>
          The full token is shown only once after creation — store it securely.
        </p>

        {revealedToken ? (
          <>
            <div style={{
              padding: 16, background: 'rgba(34,197,94,0.07)',
              border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, marginBottom: 24,
            }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
                Token created successfully. Copy it now — it won't be shown again.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>
                  {revealedToken}
                </div>
                <button className="btn btn-secondary" onClick={() => copyToClipboard(revealedToken)} style={{ flexShrink: 0 }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button className="btn btn-primary" onClick={goBack}>Done</button>
          </>
        ) : (
          <form onSubmit={handleCreate}>
            {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

            <div className="form-group">
              <label className="form-label">
                Labels <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                Tag this token to identify where it's used (e.g. "production", "ci").
              </p>
              <LabelInput labels={createLabels} setLabels={setCreateLabels} input={createLabelInput} setInput={setCreateLabelInput} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Create Token'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // ── EDIT VIEW ─────────────────────────────────────────────────────────────────

  if (view === 'edit' && editingToken) {
    return (
      <div style={{ maxWidth: 560 }}>
        <datalist id="all-labels">{allLabels.map(l => <option key={l} value={l} />)}</datalist>

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
            <LabelInput labels={editLabels} setLabels={setEditLabels} input={editLabelInput} setInput={setEditLabelInput} />
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
    );
  }

  return null;
}
