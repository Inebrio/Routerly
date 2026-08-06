/**
 * TraceLog — the detail level of the trace.
 *
 * Every entry the pipeline emitted, grouped by the phase that emitted it, in the
 * order the phases ran. Dense on purpose: this is the level you open when the
 * summary above says something went wrong and you need to see why.
 *
 * Only `trace:recap` is excluded: it is the summary shown above. The routing recap
 * stays in the log, inside the phase that produced it.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TraceEntry } from '../api';
import { TraceEntryRenderer } from './TraceEntryRenderer';

const PANEL_LABELS: Record<string, string> = {
  'router-request':  'Router Request',
  'router-response': 'Router Response',
  'request':         'Model Request',
  'response':        'Model Response',
};

const PANEL_COLORS: Record<string, string> = {
  'router-request':  '#3d75f5',
  'router-response': '#8b5cf6',
  'request':         '#3b82f6',
  'response':        '#0ea5e9',
};

/** 'request.preprocess' → 'Request · Preprocess' */
function phaseLabel(phase: string): string {
  return phase.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' · ');
}

/**
 * The entries of one pipeline phase, in the order the modules emitted them, each
 * stamped with the module that spoke and how far into the request it was.
 */
function PhaseSection({ phase, entries, startedAt, defaultOpen }: {
  phase: string; entries: TraceEntry[]; startedAt: number; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const modules = [...new Set(entries.map(e => e.module).filter(Boolean))] as string[];
  const last = entries[entries.length - 1]?.at;
  const first = entries[0]?.at;
  const spanMs = first != null && last != null ? last - first : null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0,
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
          fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)',
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{phaseLabel(phase)}</span>
        {modules.map(m => (
          <span key={m} style={{
            fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.04em',
            padding: '1px 6px', borderRadius: 4, textTransform: 'none',
            background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
          }}>{m}</span>
        ))}
        <span style={{ marginLeft: 'auto', fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>
          {entries.length} event{entries.length !== 1 ? 's' : ''}{spanMs ? ` · ${spanMs} ms` : ''}
        </span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
          {entries.map((e, i) => (
            <div key={i}>
              {e.at != null && (
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  +{e.at - startedAt} ms
                </span>
              )}
              <TraceEntryRenderer entry={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param collapsed start every phase closed — the playground shows the log next to
 * the conversation, where an open log would push the answer off screen.
 */
export function TraceLog({ entries, collapsed = false }: { entries: TraceEntry[]; collapsed?: boolean }) {
  const detail = entries.filter(e => e.message !== 'trace:recap');
  if (detail.length === 0) return null;

  // Phases in the order the pipeline walked them. Traces recorded before 0.4.0
  // carry no phase, so those fall back to the panel grouping below.
  const phases = [...new Set(detail.map(e => e.phase).filter(Boolean))] as string[];
  if (phases.length > 0) {
    const startedAt = detail.find(e => e.at != null)?.at ?? 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {phases.map(phase => (
          <PhaseSection
            key={phase}
            phase={phase}
            startedAt={startedAt}
            defaultOpen={!collapsed}
            entries={detail.filter(e => e.phase === phase)}
          />
        ))}
      </div>
    );
  }

  const panels = ['router-request', 'router-response', 'request', 'response'] as const;
  // An entry with neither phase nor a known panel would otherwise vanish, and a
  // log that hides entries is worse than an ugly one.
  const unpanelled = detail.filter(e => !panels.includes(e.panel as typeof panels[number]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {panels.map(panel => {
        const panelEntries = detail.filter(e => e.panel === panel);
        if (panelEntries.length === 0) return null;
        /* v8 ignore next */ const color = PANEL_COLORS[panel] ?? '#6b7280';
        /* v8 ignore next */ const label = PANEL_LABELS[panel] ?? panel;
        return (
          <div key={panel}>
            <div style={{
              fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
              <span style={{ color }}>{label}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 16, borderLeft: `2px solid ${color}30` }}>
              {panelEntries.map((e, i) => <TraceEntryRenderer key={i} entry={e} />)}
            </div>
          </div>
        );
      })}
      {unpanelled.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
          {unpanelled.map((e, i) => <TraceEntryRenderer key={i} entry={e} />)}
        </div>
      )}
    </div>
  );
}
