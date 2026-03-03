import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, X } from 'lucide-react';

export interface DateRange {
  from: string; // YYYY-MM-DD or ''
  to:   string; // YYYY-MM-DD or ''
  label: string;
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date) {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const PRESETS: { label: string; range: () => DateRange }[] = [
  {
    label: 'Today',
    range: () => { const t = fmt(new Date()); return { from: t, to: t, label: 'Today' }; },
  },
  {
    label: 'Yesterday',
    range: () => { const y = fmt(addDays(new Date(), -1)); return { from: y, to: y, label: 'Yesterday' }; },
  },
  {
    label: 'Last 7 days',
    range: () => ({ from: fmt(addDays(new Date(), -6)), to: fmt(new Date()), label: 'Last 7 days' }),
  },
  {
    label: 'Last 30 days',
    range: () => ({ from: fmt(addDays(new Date(), -29)), to: fmt(new Date()), label: 'Last 30 days' }),
  },
  {
    label: 'This week',
    range: () => ({ from: fmt(startOfWeek(new Date())), to: fmt(new Date()), label: 'This week' }),
  },
  {
    label: 'Last week',
    range: () => {
      const end   = addDays(startOfWeek(new Date()), -1);
      const start = startOfWeek(end);
      return { from: fmt(start), to: fmt(end), label: 'Last week' };
    },
  },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(start), to: fmt(now), label: 'This month' };
    },
  },
  {
    label: 'Last month',
    range: () => {
      const now   = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(start), to: fmt(end), label: 'Last month' };
    },
  },
  {
    label: 'All time',
    range: () => ({ from: '', to: '', label: 'All time' }),
  },
];

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen]           = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo]     = useState(value.to);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function applyCustom() {
    if (!customFrom && !customTo) return;
    const label = customFrom && customTo
      ? `${customFrom} — ${customTo}`
      : customFrom ? `From ${customFrom}` : `Until ${customTo}`;
    onChange({ from: customFrom, to: customTo, label });
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        className="btn btn-secondary btn-sm"
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180, justifyContent: 'space-between' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} />
          {value.label}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {value.from || value.to ? (
            <X size={12} style={{ opacity: 0.5 }}
              onClick={e => { e.stopPropagation(); onChange({ from: '', to: '', label: 'All time' }); }} />
          ) : null}
          <ChevronDown size={13} style={{ opacity: 0.5 }} />
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          minWidth: 260, overflow: 'hidden',
        }}>
          {/* Presets */}
          <div style={{ padding: '6px 4px' }}>
            {PRESETS.map(p => {
              const r = p.range();
              const active = r.from === value.from && r.to === value.to;
              return (
                <button key={p.label}
                  className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 12px', borderRadius: 6,
                    background: active ? undefined : 'transparent',
                    border: 'none', color: active ? undefined : 'var(--text-primary)',
                    fontSize: '0.83rem',
                  }}
                  onClick={() => { onChange(r); setOpen(false); }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Divider + custom inputs */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 12px 10px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
              Custom range
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" className="form-input" style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem' }}
                value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
              <input type="date" className="form-input" style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem' }}
                value={customTo} onChange={e => setCustomTo(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-primary" style={{ marginTop: 8, width: '100%' }}
              disabled={!customFrom && !customTo}
              onClick={applyCustom}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
