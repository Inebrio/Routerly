import React, { useCallback, useEffect, useState } from 'react';
import { Download, GripVertical } from 'lucide-react';
import { OPTIMIZER_CATALOG, type OptimizerClass } from '@routerly/shared';
import {
  getLlmLinguaModel,
  installLlmLinguaModel,
  type InstalledOptimizer,
  type LlmLinguaCheckpointState,
  type LlmLinguaModelState,
  type OptimizerId,
  type OptimizerStep,
} from '../api';
import { SearchableSelect } from './SearchableSelect';

/** Reversibility, said in one word next to the optimizer's name. */
const KLASS_COLOR: Record<OptimizerClass, string> = {
  lossless: 'var(--success)',
  recoverable: 'var(--primary)',
  lossy: 'var(--warning)',
};

export type OptimizerRow = { id: OptimizerId; enabled: boolean; threshold?: number; model?: string };

/** Configured steps first, in order, then any installed optimizer not yet configured. */
export function mergeOptimizerRows(configured: OptimizerStep[], installed: InstalledOptimizer[]): OptimizerRow[] {
  const configuredIds = new Set(configured.map(s => s.id));
  const extra: OptimizerRow[] = installed.filter(o => !configuredIds.has(o.id)).map(o => ({ id: o.id, enabled: false }));
  return [
    ...configured.map(s => ({
      id: s.id,
      enabled: s.enabled,
      ...(s.threshold != null ? { threshold: s.threshold } : {}),
      ...(s.model ? { model: s.model } : {}),
    })),
    ...extra,
  ];
}

/** Rows worth persisting: enabled, or carrying a threshold the user set. */
export function buildOptimizerSteps(rows: OptimizerRow[]): OptimizerStep[] {
  return rows
    .filter(r => r.enabled || r.threshold != null)
    .map(r => ({
      id: r.id,
      enabled: r.enabled,
      ...(r.threshold != null ? { threshold: r.threshold } : {}),
      ...(r.model ? { model: r.model } : {}),
    }));
}

/**
 * LLMLingua-2 checkpoints on the service host.
 *
 * A download runs there and takes minutes, so the only way to see it move is to
 * ask again. Polling keys off what the service reports, not off a flag set when
 * the button was clicked, so a page loaded in the middle of a download picks the
 * progress up where it is.
 */
function useLlmLinguaModel(active: boolean) {
  const [state, setState] = useState<LlmLinguaModelState | null>(null);
  const refresh = useCallback(() => { void getLlmLinguaModel().then(setState).catch(() => {}); }, []);

  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  const downloading = state?.checkpoints.some(c => c.state === 'downloading') ?? false;
  useEffect(() => {
    if (!active || !downloading) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [active, downloading, refresh]);

  return { state, setState };
}

function mb(bytes: number): number {
  return Math.round(bytes / 1e6);
}

/** One checkpoint: what it costs, whether it is here, and how to get it. */
function CheckpointRow({ checkpoint, editable, onInstall }: {
  checkpoint: LlmLinguaCheckpointState;
  editable: boolean;
  onInstall: () => void;
}) {
  const c = checkpoint;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>
          {c.label}
          {c.isDefault && (
            <span style={{ fontSize: '0.62rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>default</span>
          )}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
          {c.sizeMb > 0 ? `${c.sizeMb} MB. ` : ''}{c.note}
        </div>
        {c.state === 'downloading' && (
          <div style={{ marginTop: 6 }}>
            <div
              role="progressbar"
              aria-label={`Downloading ${c.label}`}
              aria-valuenow={c.progress ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}
            >
              {/* scaleX, not width: the bar redraws every poll and this one is
                  composited instead of reflowing the row. */}
              <div style={{
                width: '100%', height: '100%', background: 'var(--primary)',
                transform: `scaleX(${(c.progress ?? 0) / 100})`, transformOrigin: 'left',
                transition: 'transform 0.3s',
              }} />
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {c.progress ?? 0}%
              {c.totalBytes ? ` (${mb(c.loadedBytes ?? 0)} of ${mb(c.totalBytes)} MB)` : ''}
            </div>
          </div>
        )}
        {c.error && (
          <div style={{ fontSize: '0.68rem', color: 'var(--danger)', marginTop: 4 }}>{c.error}</div>
        )}
      </div>
      {c.state === 'ready' ? (
        <span style={{ fontSize: '0.68rem', color: 'var(--success)', whiteSpace: 'nowrap', paddingTop: 2 }}>Downloaded</span>
      ) : c.state === 'absent' ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!editable}
          onClick={onInstall}
          style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
        >
          <Download size={13} /> {c.error ? 'Retry' : 'Download'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The checkpoint panel, rendered inside the llmlingua-2 row: the step is useless
 * without one, so the download lives next to the switch that needs it rather
 * than in a box of its own.
 */
function LlmLinguaPanel({ state, value, onPick, onState, editable }: {
  state: LlmLinguaModelState;
  value: string;
  onPick: (key: string) => void;
  onState: (next: LlmLinguaModelState) => void;
  editable: boolean;
}) {
  const [err, setErr] = useState('');
  const ready = state.checkpoints.filter(c => c.state === 'ready');
  const picked = value === '' ? state.checkpoints.find(c => c.isDefault) : state.checkpoints.find(c => c.key === value);

  async function install(key: string) {
    setErr('');
    try {
      onState(await installLlmLinguaModel(key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to start the download');
    }
  }

  if (!state.runtimeInstalled) {
    return (
      <div style={{ fontSize: '0.7rem', color: 'var(--warning)', marginTop: 8, lineHeight: 1.45 }}>
        The optional @huggingface/transformers dependency is not installed on the service host. Install it and restart
        the service to enable this step.
      </div>
    );
  }

  return (
    <div
      style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}
      /* The row is draggable; a click meant for a control in here is not a drag. */
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
        Checkpoints on the service host. They are shared: every project that picks one uses the same download.
      </div>
      {state.checkpoints.map(c => (
        <CheckpointRow key={c.key} checkpoint={c} editable={editable} onInstall={() => void install(c.key)} />
      ))}
      {err && <div style={{ fontSize: '0.68rem', color: 'var(--danger)', marginTop: 4 }}>{err}</div>}
      {ready.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>This step runs on</span>
          <SearchableSelect
            style={{ width: 260 }}
            ariaLabel="LLMLingua-2 checkpoint"
            value={value}
            disabled={!editable}
            onChange={onPick}
            options={[
              { value: '', label: 'Default checkpoint' },
              ...ready.map(c => ({ value: c.key, label: c.label })),
            ]}
          />
        </div>
      )}
      {/* Picking the default while the default is not downloaded is the one way
          to end up with an enabled step that silently does nothing. */}
      {picked && picked.state !== 'ready' && (
        <div style={{ fontSize: '0.68rem', color: 'var(--warning)', marginTop: 6, lineHeight: 1.45 }}>
          {picked.label} is not downloaded, so this step is skipped on every request. Download it, or pick one that is.
        </div>
      )}
    </div>
  );
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
  const { state: llmLingua, setState: setLlmLingua } = useLlmLinguaModel(rows.some(r => r.id === 'llmlingua-2'));
  // Enabling llmlingua-2 with nothing downloaded produces a step that is skipped
  // on every request, so the switch waits for a checkpoint to exist.
  const llmLinguaReady = llmLingua?.checkpoints.some(c => c.state === 'ready') ?? false;

  function toggle(idx: number) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r));
  }

  function setModel(idx: number, key: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      if (key === '') { const { model, ...rest } = r; return rest; }
      return { ...r, model: key };
    }));
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
      {rows.map((row, idx) => {
        const meta = OPTIMIZER_CATALOG[row.id];
        const spec = meta?.threshold;
        const needsCheckpoint = row.id === 'llmlingua-2';
        const toggleable = editable && (!needsCheckpoint || llmLinguaReady || row.enabled);
        return (
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
          <label
            style={{ display: 'flex', alignItems: 'center', paddingTop: 1, cursor: toggleable ? 'pointer' : 'default' }}
            title={toggleable ? undefined : 'Download a checkpoint below to enable this step'}
          >
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={!toggleable}
              onChange={() => toggle(idx)}
              style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: toggleable ? 'pointer' : 'default' }}
            />
          </label>
          <div style={{ flex: 1, minWidth: 0 }} data-testid={`optimizer-row-body-${row.id}`}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{meta?.label ?? row.id}</span>
              {meta && (
                <span style={{
                  fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                  color: KLASS_COLOR[meta.klass],
                }}>
                  {meta.klass}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              {meta?.description}
            </div>
            {spec && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <label
                  htmlFor={`optimizer-threshold-${row.id}`}
                  style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}
                >
                  {spec.label}
                </label>
                <input
                  id={`optimizer-threshold-${row.id}`}
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  className="form-input"
                  placeholder={spec.default != null ? String(spec.default) : ''}
                  disabled={!editable}
                  style={{ width: 84, padding: '4px 8px', fontSize: '0.8rem' }}
                  value={row.threshold ?? ''}
                  onChange={e => setThreshold(idx, e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{spec.unit}</span>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{spec.help}</span>
              </div>
            )}
            {needsCheckpoint && llmLingua && (
              <LlmLinguaPanel
                state={llmLingua}
                value={row.model ?? ''}
                onPick={key => setModel(idx, key)}
                onState={setLlmLingua}
                editable={editable}
              />
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
