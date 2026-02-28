import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, Plus, Trash2, Edit2, Key } from 'lucide-react';
import { createProjectToken, updateProjectToken, deleteProjectToken, type ProjectToken } from '../../api';
import { useProject } from './ProjectLayout';
import { useNavigate } from 'react-router-dom';

type ModalView = 'none' | 'create' | 'edit';

export function ProjectTokenTab() {
  const { project, setProject } = useProject();
  const navigate = useNavigate();
  if (!project) return null;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [modalView, setModalView] = useState<ModalView>('none');
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
    navigate(`/dashboard/projects/${project!.id}/token/new`);
  }

  function openEdit(tokenId: string) {
    navigate(`/dashboard/projects/${project!.id}/token/${tokenId}`);
  }

  function closeModal() {
    setModalView('none'); setEditingTokenId(null); setErr('');
    if (revealedToken) {
      setRevealedToken(null);
    }
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
    if (!project) return;
    try {
      const result = await createProjectToken(project.id, createLabels);
      setProject(p => p ? { ...p, tokens: [...(p.tokens || []), result.tokenInfo] } : p);
      setRevealedToken(result.token);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error creating token'); }
    finally { setLoading(false); }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    if (!project) return;
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
      closeModal();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error saving token'); }
    finally { setLoading(false); }
  }

  async function handleDelete(tokenId: string, snippet: string) {
    if (!window.confirm(`Revoke token "${snippet}…"? Apps using it will stop working immediately.`)) return;
    setErr(''); setLoading(true);
    if (!project) return;
    try {
      await deleteProjectToken(project.id, tokenId);
      setProject(p => p ? { ...p, tokens: p.tokens?.filter(t => t.id !== tokenId) || [] } : p);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error deleting token'); }
    finally { setLoading(false); }
  }



  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ maxWidth: 720 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tokens.map(token => (
              <div key={token.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Key size={16} style={{ color: 'var(--text-muted)' }} />
                      <span className="mono" style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {token.tokenSnippet}<span style={{ opacity: 0.5 }}>••••••••</span>
                      </span>
                    </div>
                    {token.models && token.models.length > 0 && (
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8',
                        padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, border: '1px solid rgba(56, 189, 248, 0.2)'
                      }}>
                        Budget Overrides
                      </span>
                    )}
                  </div>

                  {token.labels && token.labels.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {token.labels.map(l => (
                        <span key={l} style={{
                          background: 'var(--surface-active)', border: '1px solid var(--border)',
                          padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', color: 'var(--text-secondary)'
                        }}>
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {new Date(token.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-icon" onClick={() => openEdit(token.id)} disabled={loading} title="Edit Configuration">
                      <Edit2 size={16} />
                    </button>
                    <button className="btn-icon danger" onClick={() => handleDelete(token.id, token.tokenSnippet || '')} disabled={loading} title="Revoke Token">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}

// ── Shared: label input widget ─────────────────────────────────────────────────

export function LabelInput({ labels, setLabels, input, setInput, allLabels = [] }: {
  labels: string[]; setLabels: (l: string[]) => void;
  input: string; setInput: (v: string) => void;
  allLabels?: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function addLabel(raw: string) {
    const val = raw.trim();
    if (val && !labels.includes(val)) {
      setLabels([...labels, val]);
    }
    setInput('');
    setIsOpen(false);
  }

  const suggestions = allLabels.filter(l => !labels.includes(l) && l.toLowerCase().includes(input.toLowerCase()));
  const exactMatch = allLabels.some(l => l.toLowerCase() === input.trim().toLowerCase()) || labels.some(l => l.toLowerCase() === input.trim().toLowerCase());
  const showCreateOption = input.trim() !== '' && !exactMatch;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 6, minHeight: 42, alignItems: 'center', cursor: 'text'
      }}
        onClick={(e) => {
          const target = e.currentTarget.querySelector('input');
          if (target) {
            target.focus();
            setIsOpen(true);
          }
        }}
      >
        {labels.map(label => (
          <span key={label} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--surface-active)', border: '1px solid var(--border)',
            padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem',
          }}>
            {label}
            <button type="button" onClick={(e) => {
              e.stopPropagation();
              setLabels(labels.filter(l => l !== label));
            }}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', lineHeight: 1 }}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text" value={input}
          placeholder={labels.length === 0 ? 'Search or create a label…' : ''}
          onChange={e => {
            setInput(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (input.trim()) {
                addLabel(input);
              }
            } else if (e.key === 'Backspace' && input === '' && labels.length > 0) {
              setLabels(labels.slice(0, -1));
            }
          }}
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-primary)',
            outline: 'none', flex: 1, minWidth: 140, fontSize: '0.85rem', padding: 0,
          }}
        />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: '#1A1D24', border: '1px solid var(--border)',
          borderRadius: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', maxHeight: 200, overflowY: 'auto'
        }}>
          {suggestions.length > 0 && suggestions.map(label => (
            <div key={label} onClick={() => addLabel(label)} style={{
              padding: '8px 12px', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-primary)',
              borderBottom: '1px solid var(--border)'
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-active)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {label}
            </div>
          ))}

          {showCreateOption && (
            <div onClick={() => addLabel(input)} style={{
              padding: '8px 12px', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--primary)',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-active)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              Create <span style={{ fontWeight: 600 }}>"{input}"</span>
            </div>
          )}

          {suggestions.length === 0 && !showCreateOption && (
            <div style={{ padding: '8px 12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              No matching labels found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
