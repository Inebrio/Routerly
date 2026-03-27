import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, X, ChevronLeft, ChevronRight } from 'lucide-react';

export interface DateRange {
  from: string; // ISO datetime string, YYYY-MM-DD, or ''
  to:   string; // ISO datetime string, YYYY-MM-DD, or ''
  label: string;
}

const MONTHS_IT = [
  'gennaio','febbraio','marzo','aprile','maggio','giugno',
  'luglio','agosto','settembre','ottobre','novembre','dicembre',
];
const DAYS_IT = ['lun','mar','mer','gio','ven','sab','dom'];

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
  return match ? match[1] : defaultTime;
}

/** Recent time-window presets (minutes / hours) — always use ISO datetime strings */
export const RECENT_PRESETS: { label: string; range: () => DateRange }[] = [
  {
    label: 'Ultimo minuto',
    range: () => ({ from: new Date(Date.now() - 1 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultimo minuto' }),
  },
  {
    label: 'Ultimi 3 minuti',
    range: () => ({ from: new Date(Date.now() - 3 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultimi 3 minuti' }),
  },
  {
    label: 'Ultimi 5 minuti',
    range: () => ({ from: new Date(Date.now() - 5 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultimi 5 minuti' }),
  },
  {
    label: 'Ultimi 10 minuti',
    range: () => ({ from: new Date(Date.now() - 10 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultimi 10 minuti' }),
  },
  {
    label: 'Ultimi 15 minuti',
    range: () => ({ from: new Date(Date.now() - 15 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultimi 15 minuti' }),
  },
  {
    label: 'Ultimi 30 minuti',
    range: () => ({ from: new Date(Date.now() - 30 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultimi 30 minuti' }),
  },
  {
    label: 'Ultima ora',
    range: () => ({ from: new Date(Date.now() - 60 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultima ora' }),
  },
  {
    label: 'Ultime 6 ore',
    range: () => ({ from: new Date(Date.now() - 6 * 60 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultime 6 ore' }),
  },
  {
    label: 'Ultime 12 ore',
    range: () => ({ from: new Date(Date.now() - 12 * 60 * 60_000).toISOString(), to: new Date().toISOString(), label: 'Ultime 12 ore' }),
  },
];

/** Day-level presets — use YYYY-MM-DD format */
export const PRESETS: { label: string; range: () => DateRange }[] = [
  {
    label: 'Oggi',
    range: () => { const t = fmt(new Date()); return { from: t, to: t, label: 'Oggi' }; },
  },
  {
    label: 'Ieri',
    range: () => { const y = fmt(addDays(new Date(), -1)); return { from: y, to: y, label: 'Ieri' }; },
  },
  {
    label: 'Questa settimana',
    range: () => ({ from: fmt(startOfWeek(new Date())), to: fmt(new Date()), label: 'Questa settimana' }),
  },
  {
    label: 'Questo mese',
    range: () => {
      const now = new Date();
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now), label: 'Questo mese' };
    },
  },
  {
    label: 'Questo trimestre',
    range: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return { from: fmt(new Date(now.getFullYear(), q * 3, 1)), to: fmt(now), label: 'Questo trimestre' };
    },
  },
  {
    label: "Quest'anno",
    range: () => {
      const now = new Date();
      return { from: fmt(new Date(now.getFullYear(), 0, 1)), to: fmt(now), label: "Quest'anno" };
    },
  },
  {
    label: 'Ultimi 7 giorni',
    range: () => ({ from: fmt(addDays(new Date(), -6)), to: fmt(new Date()), label: 'Ultimi 7 giorni' }),
  },
  {
    label: 'Ultimi 30 giorni',
    range: () => ({ from: fmt(addDays(new Date(), -29)), to: fmt(new Date()), label: 'Ultimi 30 giorni' }),
  },
  {
    label: 'Ultimi 12 mesi',
    range: () => ({ from: fmt(addDays(new Date(), -364)), to: fmt(new Date()), label: 'Ultimi 12 mesi' }),
  },
  {
    label: 'Tutto il tempo',
    range: () => ({ from: '', to: '', label: 'Tutto il tempo' }),
  },
];

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // Pending selection (not yet confirmed by "Seleziona")
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
    const ft = pendingFromTime.length === 5 ? pendingFromTime + ':00' : pendingFromTime;
    const tt = pendingToTime.length === 5 ? pendingToTime + ':00' : pendingToTime;
    const from = fromDate ? `${fromDate}T${ft}` : '';
    const to   = toDate   ? `${toDate}T${tt}`   : '';
    const isDefaultTimes = ft === '00:00:00' && tt === '23:59:59';
    let label: string;
    if (!fromDate) {
      label = 'Tutto il tempo';
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
          {value.label || 'Seleziona periodo'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {(value.from || value.to) ? (
            <X size={12} style={{ opacity: 0.5 }}
              onClick={e => { e.stopPropagation(); onChange({ from: '', to: '', label: 'Tutto il tempo' }); }} />
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
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
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
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
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
                  {MONTHS_IT[viewMonth]} {viewYear}
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
                {DAYS_IT.map(d => (
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
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Da</label>
                  <input type="time" step="1" value={pendingFromTime}
                    onChange={e => { let t = e.target.value; if (t.length === 5) t += ':00'; setPendingFromTime(t || '00:00:00'); }}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--text-primary)', padding: '4px 8px', fontSize: '0.82rem', flex: 1, colorScheme: 'dark',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>A</label>
                  <input type="time" step="1" value={pendingToTime}
                    onChange={e => { let t = e.target.value; if (t.length === 5) t += ':00'; setPendingToTime(t || '23:59:59'); }}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--text-primary)', padding: '4px 8px', fontSize: '0.82rem', flex: 1, colorScheme: 'dark',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Annulla</button>
            <button className="btn btn-primary btn-sm" onClick={handleConfirm}>Seleziona</button>
          </div>
        </div>
      )}
    </div>
  );
}
