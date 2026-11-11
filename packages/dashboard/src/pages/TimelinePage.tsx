import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { TIMELINE_EVENT_KINDS, type TimelineGroup, type TimelineEvent } from '@routerly/shared';
import { useAuth } from '../AuthContext.js';
import { getTimeline, getRouters, type Router, type TimelineResponse } from '../api';
import { SearchableSelect } from '../components/SearchableSelect';
import { DateRangePicker, PRESETS, RECENT_PRESETS, parseStoredRange, type DateRange } from '../components/DateRangePicker';
import { useFilterState } from '../hooks/useFilterState';
import { tokenLabel } from '../utils/tokenLabel';

const OUTCOMES = ['success', 'error', 'blocked', 'timeout', 'budget_exceeded'] as const;
const THIS_MONTH = PRESETS.find(p => p.label === 'This month');
const ALL_TIME: DateRange = { from: '', to: '', label: 'All time' };
const PAGE_SIZE = 25;

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}

/** Unknown cost is null and reads "—": a zero would claim the call was free. */
function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (n < 0.000001) return '<$0.000001';
  return `$${Number(n.toPrecision(3))}`;
}

function outcomeBadge(outcome: string): string {
  if (outcome === 'success') return 'badge-success';
  if (outcome === 'error') return 'badge-error';
  return 'badge-warning';
}

const KIND_BADGE: Record<string, string> = {
  attempt: 'badge-completion', routing: 'badge-router', guardrail: 'badge-warning',
  judge: 'badge-neutral', mcp: 'badge-policy', proxy: 'badge-neutral',
};

const mutedStyle: React.CSSProperties = { color: 'var(--text-muted)' };

function EventRow({ ev }: { ev: TimelineEvent }) {
  const { t } = useTranslation();
  const label = ev.kind === 'attempt'
    ? t('timeline.event.attemptN', { n: ev.attempt ?? 1 })
    : t(`timeline.kinds.${ev.kind}`);
  const what = ev.modelId ?? ev.name;
  return (
    <div data-testid="timeline-event" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: '0.82rem' }}>
      <span style={{ ...mutedStyle, fontVariantNumeric: 'tabular-nums', minWidth: 78 }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
      <span className={`badge ${KIND_BADGE[ev.kind] ?? 'badge-neutral'}`}>{label}</span>
      {ev.final && <span className="badge badge-success">{t('timeline.event.final')}</span>}
      {what && <span className="mono" style={{ wordBreak: 'break-all' }}>{what}</span>}
      {ev.status != null && <span className="mono" style={mutedStyle}>{ev.status}</span>}
      <span className={`badge ${outcomeBadge(ev.outcome)}`}>{t(`timeline.outcomes.${ev.outcome}`, { defaultValue: ev.outcome })}</span>
      <span style={{ ...mutedStyle, fontVariantNumeric: 'tabular-nums' }}>
        {ev.durationMs} ms{ev.ttftMs != null && ` · ${t('timeline.event.ttft', { ms: `${ev.ttftMs} ms` })}`}
      </span>
      {(ev.inputTokens != null || ev.outputTokens != null) && (
        <span style={{ ...mutedStyle, fontVariantNumeric: 'tabular-nums' }}>
          {t('timeline.event.tokens', { in: ev.inputTokens ?? '—', out: ev.outputTokens ?? '—' })}
        </span>
      )}
      <span className="mono" style={{ marginLeft: 'auto' }} data-testid="event-cost">{fmtCost(ev.cost)}</span>
      {ev.recordId && (
        <Link to={`/dashboard/usage/${ev.recordId}`} title={t('timeline.event.openRecord')} aria-label={t('timeline.event.openRecord')} style={{ display: 'inline-flex', color: 'var(--accent)' }}>
          <ExternalLink size={14} />
        </Link>
      )}
      {(ev.blockedBy || ev.errorMessage) && (
        <div style={{ flexBasis: '100%', color: ev.outcome === 'success' ? 'var(--text-secondary)' : 'var(--danger)', wordBreak: 'break-word' }}>
          {ev.blockedBy && <span>{t('timeline.event.blockedBy', { rule: ev.blockedBy })}</span>}
          {ev.blockedBy && ev.errorMessage && ' · '}
          {ev.errorMessage}
        </div>
      )}
    </div>
  );
}

function GroupCard({ g, routerName }: { g: TimelineGroup; routerName: string | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="card" data-testid="timeline-group" style={{ padding: '12px 16px', marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={open ? t('timeline.list.collapse') : t('timeline.list.expand')}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left' }}
      >
        <ChevronRight size={15} style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'none', color: 'var(--text-muted)' }} />
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.85rem' }}>{new Date(g.startedAt).toLocaleString()}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{routerName ?? (g.routerId ? g.routerId : <span style={mutedStyle}>{t('timeline.list.noRouter')}</span>)}</span>
        <span className={`badge ${outcomeBadge(g.outcome)}`}>{t(`timeline.outcomes.${g.outcome}`, { defaultValue: g.outcome })}</span>
        {g.attempts > 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('timeline.list.attempts', { count: g.attempts })}</span>}
        {g.fallback && <span className="badge badge-warning">{t('timeline.list.fallback')}</span>}
        {!g.correlated && <span className="badge badge-neutral" title={t('timeline.list.uncorrelatedHint')}>{t('timeline.list.uncorrelated')}</span>}
        <span style={{ ...mutedStyle, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>{g.durationMs} ms</span>
        <span className="mono" style={{ fontSize: '0.85rem', minWidth: 64, textAlign: 'right' }} title={g.cost == null ? t('timeline.list.unknownCost') : undefined} data-testid="group-cost">{fmtCost(g.cost)}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {g.events.map(ev => <EventRow key={ev.id} ev={ev} />)}
        </div>
      )}
    </div>
  );
}

export function TimelinePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canReport = can('report:read');
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
  const [dateRange, setDateRange] = useFilterState<DateRange>({ key: 'timeline-filters-dateRange', defaultValue: THIS_MONTH?.range() ?? ALL_TIME, deserialize: parseStoredRange });
  const [routerId, setRouterId] = useFilterState<string>({ key: 'timeline-filters-routerId', defaultValue: '' });
  const [tokenId, setTokenId] = useFilterState<string>({ key: 'timeline-filters-tokenId', defaultValue: '' });
  const [sessionId, setSessionId] = useFilterState<string>({ key: 'timeline-filters-sessionId', defaultValue: '' });
  const [endUserId, setEndUserId] = useFilterState<string>({ key: 'timeline-filters-endUserId', defaultValue: '' });
  const [kind, setKind] = useFilterState<string>({ key: 'timeline-filters-kind', defaultValue: 'all' });
  const [outcome, setOutcome] = useFilterState<string>({ key: 'timeline-filters-outcome', defaultValue: 'all' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (canReport) getRouters().then(setRouters).catch(console.error);
  }, [canReport]);

  const load = useCallback((): Promise<void> => {
    let from = dateRange.from || undefined;
    let to = dateRange.to || undefined;
    const recent = RECENT_PRESETS.find(p => p.label === dateRange.label);
    if (recent) { const fresh = recent.range(); from = fresh.from; to = fresh.to; }
    return getTimeline({
      ...(from ? { from } : {}), ...(to ? { to } : {}),
      routerId, tokenId, sessionId: sessionId.trim(), endUserId: endUserId.trim(), kind, outcome,
      page, pageSize: PAGE_SIZE,
    })
      .then(d => { setData(d); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [dateRange, routerId, tokenId, sessionId, endUserId, kind, outcome, page]);

  useEffect(() => {
    if (!canReport) return;
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load, canReport]);

  useEffect(() => { setPage(1); }, [dateRange, routerId, tokenId, sessionId, endUserId, kind, outcome]);

  const routerOptions = useMemo(() => [{ value: '', label: t('timeline.filters.allRouters') }, ...routers.map(r => ({ value: r.id, label: r.name }))], [routers, t]);
  const routerNames = useMemo(() => Object.fromEntries(routers.map(r => [r.id, r.name])), [routers]);
  const tokenOptions = useMemo(() => {
    const scope = routerId ? routers.filter(r => r.id === routerId) : routers;
    return [{ value: '', label: t('timeline.filters.allTokens') },
      ...scope.flatMap(r => (r.tokens ?? []).map(tk => ({ value: tk.id, label: routerId ? tokenLabel(tk) : `${r.name} / ${tokenLabel(tk)}` })))];
  }, [routers, routerId, t]);
  const kindOptions = useMemo(() => [{ value: 'all', label: t('timeline.filters.allKinds') }, ...TIMELINE_EVENT_KINDS.map(k => ({ value: k, label: t(`timeline.kinds.${k}`) }))], [t]);
  const outcomeOptions = useMemo(() => [{ value: 'all', label: t('timeline.filters.allOutcomes') }, ...OUTCOMES.map(o => ({ value: o, label: t(`timeline.outcomes.${o}`) }))], [t]);

  const hasFilters = routerId !== '' || tokenId !== '' || sessionId !== '' || endUserId !== '' || kind !== 'all' || outcome !== 'all';

  if (!canReport) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{t('timeline.noPermission')}</div>;
  }

  const field = (label: string, child: React.ReactNode, minWidth = 180) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth }}>
      <FilterLabel>{label}</FilterLabel>
      {child}
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>{t('timeline.title')}</h1>
            <p style={{ margin: 0 }}>{t('timeline.subtitle')}</p>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
            {t('timeline.refresh')}
          </button>
        </div>
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
        <div className="card" style={{ padding: '14px 18px', marginBottom: 20, position: 'relative', zIndex: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            {field(t('timeline.filters.period'), <DateRangePicker value={dateRange} onChange={setDateRange} />, 0)}
            {field(t('timeline.filters.router'), <SearchableSelect options={routerOptions} value={routerId} onChange={v => { setRouterId(v); setTokenId(''); }} ariaLabel={t('timeline.filters.router')} />)}
            {field(t('timeline.filters.token'), <SearchableSelect options={tokenOptions} value={tokenId} onChange={setTokenId} ariaLabel={t('timeline.filters.token')} />)}
            {field(t('timeline.filters.kind'), <SearchableSelect options={kindOptions} value={kind} onChange={setKind} ariaLabel={t('timeline.filters.kind')} />, 150)}
            {field(t('timeline.filters.outcome'), <SearchableSelect options={outcomeOptions} value={outcome} onChange={setOutcome} ariaLabel={t('timeline.filters.outcome')} />, 150)}
            {field(t('timeline.filters.sessionId'), <input className="form-input" value={sessionId} onChange={e => setSessionId(e.target.value)} placeholder={t('timeline.filters.sessionIdPlaceholder')} aria-label={t('timeline.filters.sessionId')} />, 160)}
            {field(t('timeline.filters.endUser'), <input className="form-input" value={endUserId} onChange={e => setEndUserId(e.target.value)} placeholder={t('timeline.filters.endUserPlaceholder')} aria-label={t('timeline.filters.endUser')} />, 160)}
            {hasFilters && field(' ', (
              <button className="btn btn-sm btn-secondary" onClick={() => { setRouterId(''); setTokenId(''); setSessionId(''); setEndUserId(''); setKind('all'); setOutcome('all'); }}>
                {t('timeline.filters.reset')}
              </button>
            ), 0)}
          </div>
        </div>

        {loading && !data ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : error ? (
          <div className="empty-state" style={{ color: 'var(--danger)' }}>
            <p>{t('timeline.list.loadFailedPrefix')} <strong>{error}</strong></p>
            <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>{t('timeline.list.retry')}</button>
          </div>
        ) : data && (
          <>
            <div className="stats-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <div className="stat-label">{t('timeline.summary.requests')}</div>
                <div className="stat-value">{data.totals.groups}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">{t('timeline.summary.events')}</div>
                <div className="stat-value">{data.totals.events}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">{t('timeline.summary.cost')}</div>
                <div className="stat-value">{fmtCost(data.totals.cost)}</div>
              </div>
            </div>

            {data.groups.length === 0 ? (
              <div className="empty-state"><p>{t('timeline.list.empty')}</p></div>
            ) : (
              <>
                {data.groups.map(g => <GroupCard key={g.id} g={g} routerName={g.routerId ? routerNames[g.routerId] : undefined} />)}
                {data.pagination.totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 16, padding: '10px 0' }}>
                    <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{t('timeline.pagination.previous')}</button>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {t('timeline.pagination.pageOf', { page: data.pagination.page, totalPages: data.pagination.totalPages })}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{t('timeline.pagination.total', { count: data.pagination.totalRecords })}</span>
                    </span>
                    <button className="btn btn-sm btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>{t('timeline.pagination.next')}</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
