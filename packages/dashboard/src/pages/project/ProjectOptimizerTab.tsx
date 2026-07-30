import React, { useEffect, useState } from 'react';
import { GripVertical, Check, ShieldOff } from 'lucide-react';
import {
  updateProject,
  getInstalledOptimizers,
  previewOptimizers,
  type InstalledOptimizer,
  type OptimizerId,
  type OptimizerStep,
  type OptimizerPreviewResult,
} from '../../api';
import { useProject } from './ProjectLayout';
import { useAuth } from '../../AuthContext';

const OPTIMIZER_LABELS: Record<OptimizerId, string> = {
  'session-dedup': 'Session Dedup',
  ccr: 'Conversation Context Reduction',
  rtk: 'Redundant Token Killer',
  headroom: 'Context Headroom',
  relevance: 'Relevance Filter',
  caveman: 'Caveman',
  'llmlingua-2': 'LLMLingua-2',
};

const OPTIMIZER_DESCRIPTIONS: Record<OptimizerId, string> = {
  'session-dedup': 'Lossless. Drops exact-duplicate repeated messages within a conversation, keeping the first and last of any run.',
  ccr: 'Recoverable. Keeps the system prefix and the most recent turns; older turns are condensed into a single compact block. Threshold sets how many recent turns to keep.',
  rtk: 'Lossless. Collapses redundant whitespace and strips repeated boilerplate blocks from message text.',
  headroom: 'Recoverable. Drops the oldest turns until the request fits the model context window with the reserved headroom. Threshold sets the reserved token budget.',
  relevance: 'Lossy. Drops older turns whose lexical overlap with the newest turn falls below the threshold. Requires a threshold to activate.',
  caveman: 'Lossy. Strips filler/function words from message text while preserving code, URLs and numbers.',
  'llmlingua-2': 'Lossy. ONNX-backed prompt compression. Off unless the optional runtime and model are installed.',
};

type Row = { id: OptimizerId; enabled: boolean; threshold?: number };

export function ProjectOptimizerTab() {
  const { project, setProject } = useProject();
  const { can } = useAuth();
  const canRead = can('optimizers:read');
  const canManage = can('optimizers:manage');

  const [installed, setInstalled] = useState<InstalledOptimizer[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // Preview panel state
  const [sample, setSample] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState('');
  const [preview, setPreview] = useState<OptimizerPreviewResult | null>(null);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    getInstalledOptimizers()
      .then(setInstalled)
      .catch(() => setInstalled([]))
      .finally(() => setLoading(false));
  }, [canRead]);

  // Merge the project's configured steps (in order) with any installed
  // optimizer not yet configured (appended, disabled).
  useEffect(() => {
    /* v8 ignore next */
    if (!project) return;
    const configured = project.optimizers?.steps ?? [];
    const configuredIds = new Set(configured.map(s => s.id));
    const extra: Row[] = installed
      .filter(o => !configuredIds.has(o.id))
      .map(o => ({ id: o.id, enabled: false }));
    setRows([...configured.map(s => ({ id: s.id, enabled: s.enabled, ...(s.threshold != null ? { threshold: s.threshold } : {}) })), ...extra]);
  }, [project, installed]);

  function buildSteps(): OptimizerStep[] {
    return rows
      .filter(r => r.enabled || r.threshold != null)
      .map(r => ({ id: r.id, enabled: r.enabled, ...(r.threshold != null ? { threshold: r.threshold } : {}) }));
  }

  function toggle(idx: number) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r));
  }

  function setThreshold(idx: number, value: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      if (value === '') { const { threshold, ...rest } = r; return rest; }
      return { ...r, threshold: Number(value) };
    }));
  }

  // Native HTML5 drag reorder (same pattern as ProjectRoutingTab policies).
  function onDragStart(e: React.DragEvent, idx: number) {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    /* v8 ignore next 3 */
    setTimeout(() => {
      const el = document.getElementById(`optimizer-row-${idx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }
  function onDragEnter(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    setRows(prev => {
      const copy = [...prev];
      const dragged = copy[draggedIdx]!;
      copy.splice(draggedIdx, 1);
      copy.splice(targetIdx, 0, dragged);
      return copy;
    });
    setDraggedIdx(targetIdx);
  }
  function onDragEnd(_e: React.DragEvent, idx: number) {
    setDraggedIdx(null);
    const el = document.getElementById(`optimizer-row-${idx}`);
    /* v8 ignore next */
    if (el) el.style.opacity = '1';
  }

  async function doSave() {
    /* v8 ignore next */
    if (!project) return;
    setErr('');
    setSaving(true);
    try {
      const payload: Parameters<typeof updateProject>[1] = {
        name: project.name,
        models: project.models,
        optimizers: { steps: buildSteps() },
      };
      const updated = await updateProject(project.id, payload);
      setProject(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error saving optimizers');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSave();
  }

  async function runPreview() {
    /* v8 ignore next */
    if (!project) return;
    setPreviewErr('');
    setPreview(null);
    setPreviewing(true);
    try {
      const result = await previewOptimizers({
        projectId: project.id,
        sampleMessages: [{ role: 'user', content: sample }],
        steps: buildSteps(),
      });
      setPreview(result);
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : 'Error running preview');
    } finally {
      setPreviewing(false);
    }
  }

  if (!canRead) {
    return (
      <div className="empty-state" style={{ maxWidth: 800 }}>
        <ShieldOff size={40} />
        <p>You don't have permission to view optimizers.</p>
      </div>
    );
  }

  if (loading) return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }} className="loading-center">
      <div className="spinner" />
    </div>
  );

  const savedDelta = preview ? preview.estimatedTokensBefore - preview.estimatedTokensAfter : 0;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="form-group">
        <label className="form-label">Optimizers</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Optimizers reduce prompt tokens before requests reach the provider. They run in order from top to bottom.
          Drag to reorder, toggle to enable. Some optimizers use a threshold to control how aggressively they trim.
        </p>

        {rows.length === 0 ? (
          <div className="empty-state">
            <p>No optimizers installed.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(canManage ? {} : { pointerEvents: 'none', opacity: 0.6 }) }}>
            {rows.map((row, idx) => (
              <div
                key={row.id}
                id={`optimizer-row-${idx}`}
                draggable={canManage}
                onDragStart={(e) => onDragStart(e, idx)}
                onDragEnter={(e) => onDragEnter(e, idx)}
                onDragEnd={(e) => onDragEnd(e, idx)}
                /* v8 ignore next */
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  background: 'var(--surface-active)', padding: '12px',
                  borderRadius: 8, border: '1px solid var(--border)',
                  cursor: canManage ? 'grab' : 'default', transition: 'opacity 0.2s',
                }}
              >
                <div style={{ color: 'var(--text-muted)', paddingTop: 2 }}><GripVertical size={16} /></div>
                <label style={{ display: 'flex', alignItems: 'center', paddingTop: 1, cursor: canManage ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={!canManage}
                    onChange={() => toggle(idx)}
                    style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: canManage ? 'pointer' : 'default' }}
                  />
                </label>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{OPTIMIZER_LABELS[row.id]}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                    {OPTIMIZER_DESCRIPTIONS[row.id]}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Threshold</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="form-input"
                    placeholder="auto"
                    disabled={!canManage}
                    style={{ width: 72, padding: '4px 8px', fontSize: '0.8rem' }}
                    value={row.threshold ?? ''}
                    onChange={e => setThreshold(idx, e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void doSave()}>
            {saving ? 'Saving...' : 'Save Optimizers'}
          </button>
          {saved && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--success, #22c55e)', fontSize: '0.85rem' }}>
              <Check size={16} /> Saved
            </span>
          )}
        </div>
      )}

      <div style={{ margin: '28px 0 20px', borderTop: '1px solid var(--border)' }} />

      {/* Preview token savings */}
      <div className="form-group">
        <label className="form-label" htmlFor="optimizer-sample">Preview token savings</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Run the current (unsaved) pipeline over a sample user message to estimate token deltas per step.
        </p>
        <textarea
          id="optimizer-sample"
          className="form-input"
          rows={4}
          placeholder="Paste a sample user message..."
          value={sample}
          onChange={e => setSample(e.target.value)}
          style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={previewing || sample.trim() === ''}
            onClick={() => void runPreview()}
          >
            {previewing ? 'Running...' : 'Run Preview'}
          </button>
        </div>

        {previewErr && <div className="form-error" style={{ marginTop: 12 }}>{previewErr}</div>}

        {preview && (
          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 24, padding: '12px 16px', background: 'var(--surface-active)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Before</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{preview.estimatedTokensBefore}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>After</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{preview.estimatedTokensAfter}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Saved</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: savedDelta > 0 ? 'var(--success, #22c55e)' : 'var(--text-primary)' }}>
                  {savedDelta} {preview.estimatedTokensBefore > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({Math.round((savedDelta / preview.estimatedTokensBefore) * 100)}%)</span>}
                </div>
              </div>
            </div>
            {preview.perStep.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)' }}>Optimizer</th>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)', textAlign: 'right' }}>Before</th>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)', textAlign: 'right' }}>After</th>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)', textAlign: 'right' }}>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.perStep.map((s, i) => (
                    <tr key={`${s.id}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 16px' }}>{OPTIMIZER_LABELS[s.id] ?? s.id}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{s.before}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{s.after}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace', color: s.before - s.after > 0 ? 'var(--success, #22c55e)' : 'var(--text-muted)' }}>{s.before - s.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
