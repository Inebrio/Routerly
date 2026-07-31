import React, { useState } from 'react';
import { GripVertical } from 'lucide-react';
import type { InstalledOptimizer, OptimizerId, OptimizerStep } from '../api';

export const OPTIMIZER_LABELS: Record<OptimizerId, string> = {
  'session-dedup': 'Session Dedup',
  ccr: 'Conversation Context Reduction',
  rtk: 'Redundant Token Killer',
  headroom: 'Context Headroom',
  relevance: 'Relevance Filter',
  caveman: 'Caveman',
  'llmlingua-2': 'LLMLingua-2',
};

export const OPTIMIZER_DESCRIPTIONS: Record<OptimizerId, string> = {
  'session-dedup': 'Lossless. Drops exact-duplicate repeated messages within a conversation, keeping the first and last of any run.',
  ccr: 'Recoverable. Keeps the system prefix and the most recent turns; older turns are condensed into a single compact block. Threshold sets how many recent turns to keep.',
  rtk: 'Recoverable. Collapses redundant whitespace and strips repeated boilerplate blocks from message text.',
  headroom: 'Lossless. Drops the oldest turns until the request fits the model context window with the reserved headroom. Threshold sets the reserved token budget.',
  relevance: 'Lossy. Drops older turns whose lexical overlap with the newest turn falls below the threshold. Requires a threshold to activate.',
  caveman: 'Lossy. Strips filler/function words from message text while preserving code, URLs and numbers.',
  'llmlingua-2': 'Lossy. ONNX-backed prompt compression. Off unless the optional runtime and model are installed.',
};

export type OptimizerRow = { id: OptimizerId; enabled: boolean; threshold?: number };

/** Configured steps first, in order, then any installed optimizer not yet configured. */
export function mergeOptimizerRows(configured: OptimizerStep[], installed: InstalledOptimizer[]): OptimizerRow[] {
  const configuredIds = new Set(configured.map(s => s.id));
  const extra: OptimizerRow[] = installed.filter(o => !configuredIds.has(o.id)).map(o => ({ id: o.id, enabled: false }));
  return [
    ...configured.map(s => ({ id: s.id, enabled: s.enabled, ...(s.threshold != null ? { threshold: s.threshold } : {}) })),
    ...extra,
  ];
}

/** Rows worth persisting: enabled, or carrying a threshold the user set. */
export function buildOptimizerSteps(rows: OptimizerRow[]): OptimizerStep[] {
  return rows
    .filter(r => r.enabled || r.threshold != null)
    .map(r => ({ id: r.id, enabled: r.enabled, ...(r.threshold != null ? { threshold: r.threshold } : {}) }));
}

interface OptimizerStepsEditorProps {
  rows: OptimizerRow[];
  setRows: React.Dispatch<React.SetStateAction<OptimizerRow[]>>;
  /** Read-only rendering, used when the caller lacks manage permission. */
  disabled?: boolean;
}

/**
 * Ordered optimizer pipeline with per-step enable and threshold. Shared by the
 * project optimizer tab and the optimizer profile form, so both edit the exact
 * same pipeline.
 */
export function OptimizerStepsEditor({ rows, setRows, disabled = false }: OptimizerStepsEditorProps) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const editable = !disabled;

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

  // Native HTML5 drag reorder (same pattern as RoutingPoliciesEditor).
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

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No optimizers installed.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(editable ? {} : { pointerEvents: 'none', opacity: 0.6 }) }}>
      {rows.map((row, idx) => (
        <div
          key={row.id}
          id={`optimizer-row-${idx}`}
          draggable={editable}
          onDragStart={(e) => onDragStart(e, idx)}
          onDragEnter={(e) => onDragEnter(e, idx)}
          onDragEnd={(e) => onDragEnd(e, idx)}
          /* v8 ignore next */
          onDragOver={(e) => e.preventDefault()}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            background: 'var(--surface-active)', padding: '12px',
            borderRadius: 8, border: '1px solid var(--border)',
            cursor: editable ? 'grab' : 'default', transition: 'opacity 0.2s',
          }}
        >
          <div style={{ color: 'var(--text-muted)', paddingTop: 2 }}><GripVertical size={16} /></div>
          <label style={{ display: 'flex', alignItems: 'center', paddingTop: 1, cursor: editable ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={!editable}
              onChange={() => toggle(idx)}
              style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: editable ? 'pointer' : 'default' }}
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
              disabled={!editable}
              style={{ width: 72, padding: '4px 8px', fontSize: '0.8rem' }}
              value={row.threshold ?? ''}
              onChange={e => setThreshold(idx, e.target.value)}
              onMouseDown={e => e.stopPropagation()}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
