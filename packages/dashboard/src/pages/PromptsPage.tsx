import React, { useEffect, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, CheckCircle, Save, X } from 'lucide-react';
import {
  listPrompts, createPrompt, getPrompt, activateVersion, addPromptVersion,
  deletePrompt, deletePromptVersion, updatePrompt,
} from '../api';
import type { PromptEntry, PromptVersion } from '../api';

// ── New prompt form ───────────────────────────────────────────────────────────

interface CreateForm {
  name: string;
  description: string;
  systemPrompt: string;
  projectId: string;
  notes: string;
}

const EMPTY_FORM: CreateForm = { name: '', description: '', systemPrompt: '', projectId: '', notes: '' };

// ── Highlight {{variables}} in text ──────────────────────────────────────────

function HighlightedPrompt({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <span style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
      {parts.map((part, i) =>
        part.startsWith('{{') ? (
          <mark key={i} style={{ background: 'var(--color-accent, #f59e0b)', borderRadius: 3, padding: '0 2px' }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// ── Prompt detail (expanded) ──────────────────────────────────────────────────

function PromptDetail({ prompt, onChanged }: { prompt: PromptEntry; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [newSystem, setNewSystem] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleActivate(version: number) {
    try { await activateVersion(prompt.id, version); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function handleDeleteVersion(version: number) {
    if (!confirm(`Delete version ${version}?`)) return;
    try { await deletePromptVersion(prompt.id, version); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function handleAddVersion() {
    if (!newSystem.trim()) return;
    setSaving(true); setErr('');
    try {
      await addPromptVersion(prompt.id, { systemPrompt: newSystem, ...(newNotes ? { notes: newNotes } : {}) });
      setNewSystem(''); setNewNotes(''); setAdding(false);
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.75rem 1rem', background: 'var(--color-bg-secondary, #f8fafc)', borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
      {err && <p style={{ color: 'var(--color-danger, #ef4444)', marginBottom: 8 }}>{err}</p>}
      <div style={{ marginBottom: 8 }}>
        <strong>System prompt preview</strong>
        <div style={{ marginTop: 4, padding: 8, background: 'var(--color-bg, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 4 }}>
          <HighlightedPrompt text={prompt.versions.find(v => v.version === prompt.activeVersion)?.systemPrompt ?? ''} />
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 8 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
            <th style={{ padding: '4px 8px' }}>Ver</th>
            <th style={{ padding: '4px 8px' }}>Created</th>
            <th style={{ padding: '4px 8px' }}>Notes</th>
            <th style={{ padding: '4px 8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...prompt.versions].sort((a, b) => b.version - a.version).map(v => (
            <tr key={v.version} style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)', background: v.version === prompt.activeVersion ? 'var(--color-accent-bg, #fef3c7)' : undefined }}>
              <td style={{ padding: '4px 8px' }}>
                {v.version}
                {v.version === prompt.activeVersion && (
                  <CheckCircle size={12} style={{ marginLeft: 4, color: 'var(--color-success, #22c55e)', verticalAlign: 'middle' }} />
                )}
              </td>
              <td style={{ padding: '4px 8px' }}>{new Date(v.createdAt).toLocaleDateString()}</td>
              <td style={{ padding: '4px 8px' }}>{v.notes ?? ''}</td>
              <td style={{ padding: '4px 8px' }}>
                {v.version !== prompt.activeVersion && (
                  <>
                    <button className="btn-link" onClick={() => handleActivate(v.version)} style={{ marginRight: 8 }}>Set active</button>
                    <button className="btn-link danger" onClick={() => handleDeleteVersion(v.version)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding ? (
        <div style={{ marginTop: 8 }}>
          <textarea
            placeholder="System prompt..."
            value={newSystem}
            onChange={e => setNewSystem(e.target.value)}
            rows={4}
            style={{ width: '100%', marginBottom: 4, fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <input
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            style={{ width: '100%', marginBottom: 4 }}
          />
          <button className="btn-sm" onClick={handleAddVersion} disabled={saving}>
            <Save size={12} /> Save version
          </button>
          <button className="btn-sm secondary" onClick={() => setAdding(false)} style={{ marginLeft: 6 }}>
            <X size={12} /> Cancel
          </button>
        </div>
      ) : (
        <button className="btn-sm" onClick={() => setAdding(true)}>
          <Plus size={12} /> Add version
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError('');
    try { setPrompts(await listPrompts()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load prompts'); }
    finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.systemPrompt.trim()) return;
    setCreating(true); setError('');
    try {
      await createPrompt({
        name: form.name,
        systemPrompt: form.systemPrompt,
        ...(form.description ? { description: form.description } : {}),
        ...(form.projectId ? { projectId: form.projectId } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      });
      setForm(EMPTY_FORM); setShowCreate(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete prompt "${name}" and all its versions?`)) return;
    try { await deletePrompt(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => prev === id ? null : id);
  }

  if (loading) return <p>Loading prompts...</p>;

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Prompts</h2>
        <button className="btn-primary" onClick={() => setShowCreate(v => !v)}>
          <Plus size={14} /> New prompt
        </button>
      </div>

      {error && <p style={{ color: 'var(--color-danger, #ef4444)', marginBottom: 12 }}>{error}</p>}

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: 16, padding: 16, border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 6, background: 'var(--color-bg-secondary, #f8fafc)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label>Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required style={{ width: '100%' }} />
            </div>
            <div>
              <label>Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>System prompt * (use {`{{variable}}`} for dynamic values)</label>
            <textarea
              value={form.systemPrompt}
              onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              required rows={5}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <label>Project ID (optional, leave blank for global)</label>
              <input value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div>
              <label>Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ width: '100%' }} />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={creating}>Create</button>
          <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)} style={{ marginLeft: 8 }}>Cancel</button>
        </form>
      )}

      {prompts.length === 0 ? (
        <p style={{ color: 'var(--color-muted, #64748b)' }}>No prompts yet. Click "New prompt" to create one.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border, #e2e8f0)' }}>
              <th style={{ padding: '8px 12px' }}></th>
              <th style={{ padding: '8px 12px' }}>Name</th>
              <th style={{ padding: '8px 12px' }}>Scope</th>
              <th style={{ padding: '8px 12px' }}>Active ver</th>
              <th style={{ padding: '8px 12px' }}>Versions</th>
              <th style={{ padding: '8px 12px' }}>Created</th>
              <th style={{ padding: '8px 12px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map(p => (
              <React.Fragment key={p.id}>
                <tr style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <button className="btn-icon" onClick={() => toggleExpand(p.id)} title="Expand">
                      {expanded === p.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <strong>{p.name}</strong>
                    {p.description && <div style={{ fontSize: '0.8rem', color: 'var(--color-muted, #64748b)' }}>{p.description}</div>}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: '0.8rem' }}>{p.projectId ?? <em>global</em>}</td>
                  <td style={{ padding: '8px 12px' }}>v{p.activeVersion}</td>
                  <td style={{ padding: '8px 12px' }}>{p.versions.length}</td>
                  <td style={{ padding: '8px 12px', fontSize: '0.8rem' }}>
                    {p.versions[0] ? new Date(p.versions[0].createdAt).toLocaleDateString() : ''}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button className="btn-icon danger" onClick={() => handleDelete(p.id, p.name)} title="Delete prompt">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                {expanded === p.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <PromptDetail prompt={p} onChanged={load} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
