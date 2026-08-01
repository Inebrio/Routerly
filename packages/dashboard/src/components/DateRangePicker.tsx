import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, X, ChevronLeft, ChevronRight } from 'lucide-react';

export interface DateRange {
  from: string; // ISO datetime string, YYYY-MM-DD, or ''
  to:   string; // ISO datetime string, YYYY-MM-DD, or ''
  label: string;
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

/** Returns a calendar grid array (Mon-based) for given year/month */
function getCalendarDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() + 6) % 7; // Mon=0
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date) {
  const r = new Date(d);
  r.setDate(r.getDate() - (r.getDay() === 0 ? 6 : r.getDay() - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function parseTimeFromISO(iso: string, defaultTime: string): string {
  if (!iso || iso.length <= 10) return defaultTime;
  const match = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  /* v8 ignore next */
  return match?.[1] ?? defaultTime;
}

/** Recent time-window presets (minutes / hours) — always use ISO datetime strings */
export const RECENT_PRESETS: { label: string; range: () => DateRange }[] = [
  {
    label: 'Last minute',
    range: () => ({ from: new Date(Date.now() - 1 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last minute' }),
  },
  {
    label: 'Last 3 minutes',
    range: () => ({ from: new Date(Date.now() - 3 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 3 minutes' }),
  },
  {
    label: 'Last 5 minutes',
    range: () => ({ from: new Date(Date.now() - 5 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 5 minutes' }),
  },
  {
    label: 'Last 10 minutes',
    range: () => ({ from: new Date(Date.now() - 10 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 10 minutes' }),
  },
  {
    label: 'Last 15 minutes',
    range: () => ({ from: new Date(Date.now() - 15 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 15 minutes' }),
  },
  {
    label: 'Last 30 minutes',
    range: () => ({ from: new Date(Date.now() - 30 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 30 minutes' }),
  },
  {
    label: 'Last hour',
    range: () => ({ from: new Date(Date.now() - 60 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last hour' }),
  },
  {
    label: 'Last 6 hours',
    range: () => ({ from: new Date(Date.now() - 6 * 60 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 6 hours' }),
  },
  {
    label: 'Last 12 hours',
    range: () => ({ from: new Date(Date.now() - 12 * 60 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Last 12 hours' }),
  },
];

/** Day-level presets — use YYYY-MM-DD format */
export const PRESETS: { label: string; range: () => DateRange }[] = [
  {
    label: 'Today',
    range: () => { const t = fmt(new Date()); return { from: t, to: t, label: 'Today' }; },
  },
  {
    label: 'Yesterday',
    range: () => { const y = fmt(addDays(new Date(), -1)); return { from: y, to: y, label: 'Yesterday' }; },
  },
  {
    label: 'This week',
    range: () => ({ from: fmt(startOfWeek(new Date())), to: fmt(new Date()), label: 'This week' }),
  },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now), label: 'This month' };
    },
  },
  {
    label: 'This quarter',
    range: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return { from: fmt(new Date(now.getFullYear(), q * 3, 1)), to: fmt(now), label: 'This quarter' };
    },
  },
  {
    label: 'This year',
    range: () => {
      const now = new Date();
      return { from: fmt(new Date(now.getFullYear(), 0, 1)), to: fmt(now), label: 'This year' };
    },
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
    label: 'Last 12 months',
    range: () => ({ from: fmt(addDays(new Date(), -364)), to: fmt(new Date()), label: 'Last 12 months' }),
  },
  {
    label: 'All time',
    range: () => ({ from: '', to: '', label: 'All time' }),
  },
];

/** Preset labels shipped in Italian up to 0.3.x, still sitting in saved filter state */
const LEGACY_LABELS: Record<string, string> = {
  'Ultimo minuto': 'Last minute',   'Ultimi 3 minuti': 'Last 3 minutes',
  'Ultimi 5 minuti': 'Last 5 minutes', 'Ultimi 10 minuti': 'Last 10 minutes',
  'Ultimi 15 minuti': 'Last 15 minutes', 'Ultimi 30 minuti': 'Last 30 minutes',
  'Ultima ora': 'Last hour',        'Ultime 6 ore': 'Last 6 hours',
  'Ultime 12 ore': 'Last 12 hours', 'Oggi': 'Today',
  'Ieri': 'Yesterday',              'Questa settimana': 'This week',
  'Questo mese': 'This month',      'Questo trimestre': 'This quarter',
  "Quest'anno": 'This year',        'Ultimi 7 giorni': 'Last 7 days',
  'Ultimi 30 giorni': 'Last 30 days', 'Ultimi 12 mesi': 'Last 12 months',
  'Tutto il tempo': 'All time',
};

/**
 * Deserializer for persisted DateRange filter state: upgrades the labels older
 * builds saved, so a stored preset keeps matching PRESETS after the rename.
 */
export function parseStoredRange(value: string): DateRange {
  const range = JSON.parse(value) as DateRange;
  const upgraded = LEGACY_LABELS[range.label];
  return upgraded ? { ...range, label: upgraded } : range;
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // Pending selection (not yet confirmed by "Apply")
  const [pendingFrom, setPendingFrom] = useState(value.from);
  const [pendingTo,   setPendingTo]   = useState(value.to);
  const [pickingEnd,  setPickingEnd]  = useState(false);
  const [hovered,     setHovered]     = useState('');
  const [pendingFromTime, setPendingFromTime] = useState('00:00:00');
  const [pendingToTime, setPendingToTime]     = useState('23:59:59');

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPendingFrom((value.from || '').slice(0, 10));
    setPendingTo((value.to || '').slice(0, 10));
    setPendingFromTime(parseTimeFromISO(value.from, '00:00:00'));
    setPendingToTime(parseTimeFromISO(value.to, '23:59:59'));
    setPickingEnd(false);
  }, [value]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPendingFrom((value.from || '').slice(0, 10));
        setPendingTo((value.to || '').slice(0, 10));
        setPendingFromTime(parseTimeFromISO(value.from, '00:00:00'));
        setPendingToTime(parseTimeFromISO(value.to, '23:59:59'));
        setPickingEnd(false);
        setHovered('');
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [value]);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(d: Date) {
    const ds = fmt(d);
    if (!pickingEnd) {
      setPendingFrom(ds);
      setPendingTo('');
      setPickingEnd(true);
    } else {
      let from = pendingFrom;
      let to   = ds;
      if (from > to) [from, to] = [to, from];
      setPendingFrom(from);
      setPendingTo(to);
      setPickingEnd(false);
      setHovered('');
    }
  }

  function handleConfirm() {
    const fromDate = pendingFrom;
    const toDate   = pendingTo || pendingFrom;
    /* v8 ignore next */
    const ft = pendingFromTime.length === 5 ? pendingFromTime + ':00' : pendingFromTime;
    /* v8 ignore next */
    const tt = pendingToTime.length === 5 ? pendingToTime + ':00' : pendingToTime;
    const from = fromDate ? `${fromDate}T${ft}` : '';
    const to   = toDate   ? `${toDate}T${tt}`   : '';
    const isDefaultTimes = ft === '00:00:00' && tt === '23:59:59';
    let label: string;
    if (!fromDate) {
      label = 'All time';
    } else if (fromDate === toDate && isDefaultTimes) {
      label = fromDate;
    } else if (fromDate === toDate) {
      label = `${fromDate} ${ft.slice(0, 5)}\u2013${tt.slice(0, 5)}`;
    } else if (isDefaultTimes) {
      label = `${fromDate} — ${toDate}`;
    } else {
      label = `${fromDate} ${ft.slice(0, 5)} — ${toDate} ${tt.slice(0, 5)}`;
    }
    onChange({ from, to, label });
    setOpen(false);
    setPickingEnd(false);
  }

  function handleCancel() {
    setPendingFrom((value.from || '').slice(0, 10));
    setPendingTo((value.to || '').slice(0, 10));
    setPendingFromTime(parseTimeFromISO(value.from, '00:00:00'));
    setPendingToTime(parseTimeFromISO(value.to, '23:59:59'));
    setPickingEnd(false);
    setHovered('');
    setOpen(false);
  }

  function handlePreset(r: DateRange) {
    setPendingFrom(r.from);
    setPendingTo(r.to);
    setPickingEnd(false);
    onChange(r);
    setOpen(false);
  }

  // Display range: while picking second date, show hover preview
  const dispFrom = !pickingEnd || !hovered ? pendingFrom : (pendingFrom < hovered ? pendingFrom : hovered);
  const dispTo   = !pickingEnd || !hovered ? pendingTo   : (pendingFrom < hovered ? hovered : pendingFrom);

  const today = fmt(new Date());
  const days  = getCalendarDays(viewYear, viewMonth);
  const ACCENT15 = 'rgba(99,102,241,0.18)';

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
          {value.label || 'Select period'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {(value.from || value.to) ? (
            <X size={12} style={{ opacity: 0.5 }}
              onClick={e => { e.stopPropagation(); onChange({ from: '', to: '', label: 'All time' }); }} />
          ) : null}
          <ChevronDown size={13} style={{ opacity: 0.5 }} />
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 1000,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          minWidth: 490,
        }}>
          <div style={{ display: 'flex' }}>

            {/* ── Preset list ── */}
            <div style={{
              width: 180, borderRight: '1px solid var(--border)',
              padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 1,
              overflowY: 'auto', maxHeight: 420,
            }}>
              {/* Section: Recenti */}
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '6px 12px 2px' }}>
                Recenti
              </div>
              {/* "From now" — freezes 'from' to the clicked instant, open-ended 'to' */}
              {(() => {
                const active = value.label === 'From now';
                return (
                  <button
                    onClick={() => handlePreset({ from: new Date().toISOString(), to: '', label: 'From now' })}
                    style={{
                      background: active ? 'var(--accent, #6366f1)' : 'transparent',
                      border: 'none', borderRadius: 6,
                      padding: '7px 12px', textAlign: 'left',
                      color: active ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.84rem', cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    From now
                  </button>
                );
              })()}
              {RECENT_PRESETS.map(p => {
                const active = p.label === value.label;
                return (
                  <button
                    key={p.label}
                    onClick={() => handlePreset(p.range())}
                    style={{
                      background: active ? 'var(--accent, #6366f1)' : 'transparent',
                      border: 'none', borderRadius: 6,
                      padding: '7px 12px', textAlign: 'left',
                      color: active ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.84rem', cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      transition: 'background 0.1s',
                    }}
                    /* v8 ignore next */
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
                    /* v8 ignore next */
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {p.label}
                  </button>
                );
              })}
              {/* Separator */}
              <div style={{ height: 1, background: 'var(--border)', margin: '6px 12px' }} />
              {/* Section: Intervalli */}
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '4px 12px 2px' }}>
                Intervalli
              </div>
              {PRESETS.map(p => {
                const r = p.range();
                const active = r.label === value.label && r.from === value.from && r.to === value.to;
                return (
                  <button
                    key={p.label}
                    onClick={() => handlePreset(r)}
                    style={{
                      background: active ? 'var(--accent, #6366f1)' : 'transparent',
                      border: 'none', borderRadius: 6,
                      padding: '7px 12px', textAlign: 'left',
                      color: active ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.84rem', cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      transition: 'background 0.1s',
                    }}
                    /* v8 ignore next */
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
                    /* v8 ignore next */
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* ── Calendar ── */}
            <div style={{ flex: 1, padding: '16px 18px 12px' }}>

              {/* Month navigation */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <button onClick={prevMonth}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 6, display: 'flex' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {MONTHS[viewMonth]} {viewYear}
                </span>
                <button onClick={nextMonth}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 6, display: 'flex' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Weekday headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 4 }}>
                {DAYS.map(d => (
                  <div key={d} style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '2px 0' }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {days.map((d, i) => {
                  if (!d) return <div key={`pad-${i}`} style={{ height: 36 }} />;

                  const ds          = fmt(d);
                  const isToday     = ds === today;
                  const isFrom      = dispFrom !== '' && ds === dispFrom;
                  const isTo        = dispTo   !== '' && ds === dispTo;
                  const isEndpoint  = isFrom || isTo;
                  const inRange     = !!(dispFrom && dispTo && ds > dispFrom && ds < dispTo);
                  const isOtherMon  = d.getMonth() !== viewMonth;

                  // Range band behind the circle
                  let wrapBg = 'transparent';
                  if (inRange)               wrapBg = ACCENT15;
                  if (isFrom && dispTo)      wrapBg = `linear-gradient(to right, transparent 50%, ${ACCENT15} 50%)`;
                  if (isTo   && dispFrom)    wrapBg = `linear-gradient(to left,  transparent 50%, ${ACCENT15} 50%)`;

                  // Circle styling
                  let circleBg     = 'transparent';
                  /* v8 ignore next */
                  let circleColor  = isOtherMon ? 'var(--text-muted)' : 'var(--text-primary)';
                  let circleWeight: number | string = 400;
                  let circleBorder = 'transparent';

                  if (isEndpoint) {
                    circleBg     = 'var(--accent, #6366f1)';
                    circleColor  = '#fff';
                    circleWeight = 700;
                  } else if (isToday) {
                    circleBorder = 'var(--accent, #6366f1)';
                    circleWeight = 700;
                  }

                  return (
                    <div key={ds} style={{ background: wrapBg, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36 }}>
                      <div
                        onClick={() => !isOtherMon && handleDayClick(d)}
                        onMouseEnter={() => { if (pickingEnd && !isOtherMon) setHovered(ds); }}
                        onMouseLeave={() => { if (pickingEnd) setHovered(''); }}
                        style={{
                          width: 32, height: 32,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: '50%',
                          background: circleBg,
                          color: circleColor,
                          fontWeight: circleWeight,
                          fontSize: '0.85rem',
                          border: `2px solid ${circleBorder}`,
                          /* v8 ignore next */
                          cursor: isOtherMon ? 'default' : 'pointer',
                          userSelect: 'none',
                          boxSizing: 'border-box',
                          transition: 'background 0.12s',
                        }}
                        onMouseOver={e => {
                          if (!isOtherMon && !isEndpoint)
                            (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)';
                        }}
                        onMouseOut={e => {
                          if (!isEndpoint)
                            (e.currentTarget as HTMLElement).style.background = circleBg;
                        }}
                      >
                        {d.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Time inputs */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>From</label>
                  <input type="time" step="1" value={pendingFromTime}
                    onChange={e => { let t = e.target.value; if (t.length === 5) t += ':00'; setPendingFromTime(t || '00:00:00'); }}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--text-primary)', padding: '4px 8px', fontSize: '0.82rem', flex: 1, colorScheme: 'light dark',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>To</label>
                  <input type="time" step="1" value={pendingToTime}
                    onChange={e => { let t = e.target.value; if (t.length === 5) t += ':00'; setPendingToTime(t || '23:59:59'); }}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--text-primary)', padding: '4px 8px', fontSize: '0.82rem', flex: 1, colorScheme: 'light dark',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleConfirm}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
