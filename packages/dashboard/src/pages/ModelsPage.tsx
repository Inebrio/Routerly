import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Server, Edit2, Copy, ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Telescope, FlaskConical, RotateCcw } from 'lucide-react';
import { getModels, deleteModel, testModel, getProviderHealth, resetResilience, getConnections, type Model, type ProviderHealth, type ResilienceState, type Connection } from '../api';
import { useAuth } from '../AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { useProviderLabels } from '../hooks/useProviderLabels';

type SortKey = 'id' | 'provider' | 'endpoint' | 'input' | 'output' | 'cache' | 'context';
type HealthSortKey = 'id' | 'provider' | 'status' | 'circuit' | 'errorRate' | 'p95Latency' | 'requests' | 'lastSuccess' | 'cooldown';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 20;
const HEALTH_REFRESH_MS = 30_000;

function numOrInfinity(v: number | null | undefined) { return v ?? Infinity; }

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35, marginLeft: 4, flexShrink: 0 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />
    : <ChevronDown size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />;
}

// ── Health helpers ─────────────────────────────────────────────────────────────

// ponytail: 'nodata' is a local extension; ProviderHealth['status'] covers the real statuses
type ExtendedStatus = ProviderHealth['status'] | 'nodata';

// Sort order: lower = worse (sorts last when desc, i.e. always "best first" for status col)
// nodata sentinel ensures no-data rows sink to bottom regardless of direction
const STATUS_SEVERITY: Record<ExtendedStatus, number> = {
  unavailable: 0,
  degraded:    1,
  cooldown:    2,
  healthy:     3,
  nodata:      999, // always last
};

const STATUS_COLOR: Record<ExtendedStatus, string> = {
  healthy:     'var(--success)',
  degraded:    'var(--warning)',
  unavailable: 'var(--danger)',
  cooldown:    'var(--text-muted)',
  nodata:      'var(--text-muted)',
};

function StatusBadge({ status, label }: { status: ExtendedStatus; label: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: '0.8rem', fontWeight: 600, color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

function relativeTime(iso: string | null, t: TFunction): string {
  if (!iso) return t('models.page.health.time.never');
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return t('models.page.health.time.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('models.page.health.time.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('models.page.health.time.hoursAgo', { count: h });
  return t('models.page.health.time.daysAgo', { count: Math.floor(h / 24) });
}

function cooldownTimer(until: number | null): string | null {
  if (!until) return null;
  const ms = until - Date.now();
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}

// ── Circuit-breaker helpers (absorbed from the former ResiliencePage) ──────────
// Reused badge classes and countdown so the circuit signal is visually identical
// to what the standalone page rendered.
const CIRCUIT_BADGE: Record<ResilienceState, string> = {
  closed: 'badge-success',
  'half-open': 'badge-warning',
  open: 'badge-error',
};

// Human-friendly labels: circuit-breaker "closed = healthy / open = tripped" reads backwards to
// most people, so surface plain-meaning words. Internal state values stay closed/half-open/open.
const CIRCUIT_LABEL_KEY: Record<ResilienceState, string> = {
  closed: 'models.page.health.circuit.ok',
  'half-open': 'models.page.health.circuit.recovering',
  open: 'models.page.health.circuit.tripped',
};

// Sort severity: lower = worse (mirrors STATUS_SEVERITY so `sb - sa` puts worst first on desc).
const CIRCUIT_SEVERITY: Record<ResilienceState | 'nodata', number> = {
  open: 0,
  'half-open': 1,
  closed: 2,
  nodata: 999, // always last
};

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatCountdown(targetMs: number, now: number, t: TFunction): string {
  const remaining = targetMs - now;
  if (remaining <= 0) return t('models.page.health.time.now');
  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? t('models.page.health.time.minSec', { min, sec }) : t('models.page.health.time.sec', { sec });
}

// ── Models page ────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canManage = can('resilience:manage');
  const canWriteModels = can('model:write');
  const now = useNow();
  const navigate = useNavigate();
  const providerLabel = useProviderLabels();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'health' ? 'health' : 'models';
  function setTab(t: 'models' | 'health') {
    setSearchParams(t === 'health' ? { tab: 'health' } : {}, { replace: true });
  }

  const [models, setModels] = useState<Model[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [healthMap, setHealthMap] = useState<Map<string, ProviderHealth>>(new Map());
  const [loading, setLoading] = useState(true);
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState(() => searchParams.get('provider') ?? '');
  const [connectionFilter, setConnectionFilter] = useState(() => searchParams.get('connection') ?? '');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, 'loading' | { ok: boolean; latencyMs: number; error?: string }>>({});
  const healthActive = useRef(true);

  // Health tab state
  const [hSearch, setHSearch] = useState('');
  const [hSortKey, setHSortKey] = useState<HealthSortKey>('status');
  const [hSortDir, setHSortDir] = useState<SortDir>('asc');
  const [hPage, setHPage] = useState(1);

  // Resilience reset state (health tab): busy key is a model id, 'all', or null
  const [resetBusy, setResetBusy] = useState<string | null>(null);
  const [resetError, setResetError] = useState('');

  // Load models once
  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setModels(await getModels()); } finally { setLoading(false); }
  }

  // Connections power the connection filter; best-effort like health.
  useEffect(() => { getConnections().then(setConnections).catch(() => {}); }, []);

  function updateProviderFilter(v: string) {
    setProviderFilter(v);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v) next.set('provider', v); else next.delete('provider');
      return next;
    }, { replace: true });
  }

  function updateConnectionFilter(v: string) {
    setConnectionFilter(v);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v) next.set('connection', v); else next.delete('connection');
      return next;
    }, { replace: true });
  }

  const fetchHealth = useCallback(async () => {
    try {
      const { providers } = await getProviderHealth();
      if (!healthActive.current) return;
      setHealthMap(new Map(providers.map(p => [p.modelId, p])));
      setHealthUpdatedAt(new Date());
    } catch {
      // health is best-effort; model list still shows
    }
  }, []);

  // Load health + poll every 30s
  useEffect(() => {
    healthActive.current = true;
    fetchHealth();
    const id = setInterval(fetchHealth, HEALTH_REFRESH_MS);
    return () => { healthActive.current = false; clearInterval(id); };
  }, [fetchHealth]);

  async function handleResetModel(m: Model) {
    setResetBusy(m.id);
    setResetError('');
    try {
      // A model row aggregates three breaker keys: provider circuit, connection
      // cooldown, and model lockout. Reset ALL THREE so the row returns to
      // closed/available — resetting only the model key would leave a
      // provider-open circuit or connection cooldown still blocking the row.
      await Promise.all([
        resetResilience({ level: 'provider', id: m.provider }),
        resetResilience({ level: 'connection', id: m.provider }),
        resetResilience({ level: 'model', id: m.id }),
      ]);
      await fetchHealth();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : t('models.page.health.errors.resetModelFailed'));
    } finally {
      setResetBusy(null);
    }
  }

  async function handleResetAll() {
    setResetBusy('all');
    setResetError('');
    try {
      await resetResilience();
      await fetchHealth();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : t('models.page.health.errors.resetAllFailed'));
    } finally {
      setResetBusy(null);
    }
  }

  function confirmResetModel(m: Model) {
    setConfirmState({
      message: t('models.page.health.confirmResetModel', { id: m.id }),
      onConfirm: () => { setConfirmState(null); void handleResetModel(m); },
    });
  }

  function confirmResetAll() {
    setConfirmState({
      message: t('models.page.health.confirmResetAll'),
      onConfirm: () => { setConfirmState(null); void handleResetAll(); },
    });
  }

  async function handleTest(id: string) {
    setTestResults(r => ({ ...r, [id]: 'loading' }));
    const result = await testModel(id);
    setTestResults(r => ({ ...r, [id]: result }));
  }

  function handleDelete(id: string) {
    setConfirmState({
      message: t('models.page.deleteConfirm', { id }),
      onConfirm: async () => {
        setConfirmState(null);
        await deleteModel(id);
        setModels(m => m.filter(x => x.id !== id));
      },
    });
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, providerFilter, connectionFilter]);

  const providerOptions = useMemo(
    () => Array.from(new Set(models.map(m => m.provider))).sort(),
    [models],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter(m => {
      if (providerFilter && m.provider !== providerFilter) return false;
      if (connectionFilter && m.connectionId !== connectionFilter) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.endpoint.toLowerCase().includes(q);
    });
  }, [models, search, providerFilter, connectionFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':       cmp = a.id.localeCompare(b.id); break;
        case 'provider': cmp = a.provider.localeCompare(b.provider); break;
        case 'endpoint': cmp = a.endpoint.localeCompare(b.endpoint); break;
        case 'input':    cmp = a.cost.inputPerMillion - b.cost.inputPerMillion; break;
        case 'output':   cmp = a.cost.outputPerMillion - b.cost.outputPerMillion; break;
        case 'cache':    cmp = numOrInfinity(a.cost.cachePerMillion) - numOrInfinity(b.cost.cachePerMillion); break;
        case 'context':  cmp = numOrInfinity(a.contextWindow) - numOrInfinity(b.contextWindow); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(Math.max(1, totalPages)); }, [page, totalPages]);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Health tab computed ────────────────────────────────────────────────────
  const hFiltered = useMemo(() => {
    const q = hSearch.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m => m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
  }, [models, hSearch]);

  const hSorted = useMemo(() => [...hFiltered].sort((a, b) => {
    const ha = healthMap.get(a.id);
    const hb = healthMap.get(b.id);
    if (!ha && !hb) return 0;
    if (!ha) return 1;
    if (!hb) return -1;
    const sa: ExtendedStatus = cooldownTimer(ha.cooldownUntil) ? 'cooldown' : ha.status;
    const sb: ExtendedStatus = cooldownTimer(hb.cooldownUntil) ? 'cooldown' : hb.status;
    let cmp = 0;
    switch (hSortKey) {
      case 'id':          cmp = a.id.localeCompare(b.id); break;
      case 'provider':    cmp = a.provider.localeCompare(b.provider); break;
      case 'status':      cmp = STATUS_SEVERITY[sb] - STATUS_SEVERITY[sa]; break;
      case 'circuit':     cmp = CIRCUIT_SEVERITY[hb.circuitState] - CIRCUIT_SEVERITY[ha.circuitState]; break;
      case 'errorRate':   cmp = ha.errorRate - hb.errorRate; break;
      case 'p95Latency':  cmp = (ha.p95LatencyMs ?? Infinity) - (hb.p95LatencyMs ?? Infinity); break;
      case 'requests':    cmp = ha.requestsLastHour - hb.requestsLastHour; break;
      case 'lastSuccess': cmp = (ha.lastSuccessAt ? new Date(ha.lastSuccessAt).getTime() : -Infinity)
                              - (hb.lastSuccessAt ? new Date(hb.lastSuccessAt).getTime() : -Infinity); break;
      case 'cooldown':    cmp = (ha.cooldownUntil ? new Date(ha.cooldownUntil).getTime() : 0)
                              - (hb.cooldownUntil ? new Date(hb.cooldownUntil).getTime() : 0); break;
    }
    return hSortDir === 'asc' ? cmp : -cmp;
  }), [hFiltered, hSortKey, hSortDir, healthMap]);

  const hTotalPages = Math.max(1, Math.ceil(hSorted.length / PAGE_SIZE));
  useEffect(() => { if (hPage > hTotalPages) setHPage(Math.max(1, hTotalPages)); }, [hPage, hTotalPages]);
  useEffect(() => { setHPage(1); }, [hSearch]);
  const hPaginated = hSorted.slice((hPage - 1) * PAGE_SIZE, hPage * PAGE_SIZE);

  function handleHSort(key: HealthSortKey) {
    if (key === hSortKey) setHSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setHSortKey(key); setHSortDir('asc'); }
  }
  const hTh = (label: string, key: HealthSortKey, align?: 'right') => (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: align }} onClick={() => handleHSort(key)}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        {label}<SortIcon col={key} sortKey={hSortKey} sortDir={hSortDir} />
      </span>
    </th>
  );

  const thStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const thInner = (label: string, key: SortKey) => (
    <span style={{ display: 'inline-flex', alignItems: 'center' }} onClick={() => handleSort(key)}>
      {label}<SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
    </span>
  );

  const tabStyle = (t: 'models' | 'health'): React.CSSProperties => ({
    padding: '0 4px 12px',
    fontSize: '0.9rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer',
    color: tab === t ? 'var(--primary)' : 'var(--text-secondary)',
    borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
    transition: 'color 0.15s',
    marginBottom: -1,
  });

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>{t('models.page.title')}</h1>
        <p>{t('models.page.subtitle')}</p>
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginTop: 12 }}>
          <button style={tabStyle('models')} onClick={() => setTab('models')}>{t('models.page.tabs.models')}</button>
          <button style={tabStyle('health')} onClick={() => setTab('health')}>{t('models.page.tabs.health')}</button>
        </div>
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
        {tab === 'models' && (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {filtered.length !== models.length
                  ? t('models.page.toolbar.filteredCount', { filtered: filtered.length, count: models.length })
                  : t('models.page.toolbar.count', { count: models.length })}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <SearchableSelect
                  options={[{ value: '', label: t('models.page.filters.allProviders') }, ...providerOptions.map(p => ({ value: p, label: providerLabel(p) }))]}
                  value={providerFilter}
                  onChange={updateProviderFilter}
                  placeholder={t('models.page.filters.allProviders')}
                  style={{ width: 160 }}
                />
                <SearchableSelect
                  options={[{ value: '', label: t('models.page.filters.allConnections') }, ...connections.map(c => ({ value: c.id, label: c.label }))]}
                  value={connectionFilter}
                  onChange={updateConnectionFilter}
                  placeholder={t('models.page.filters.allConnections')}
                  style={{ width: 180 }}
                />
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('models.page.filters.searchPlaceholder')}
                    style={{ paddingLeft: 28, paddingRight: search ? 28 : 10, height: 32, fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 200 }}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                {canWriteModels && (
                  <>
                    <Link to="/dashboard/models/discover" className="btn">
                      <Telescope size={16} /> {t('models.page.discover')}
                    </Link>
                    <Link
                      to={connectionFilter ? `/dashboard/models/new?connection=${encodeURIComponent(connectionFilter)}` : '/dashboard/models/new'}
                      className="btn btn-primary"
                    >
                      <Plus size={16} /> {t('models.page.addModel')}
                    </Link>
                  </>
                )}
              </div>
            </div>
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : models.length === 0 ? (
              <div className="empty-state"><Server size={40} /><p>{t('models.page.empty.noModels')}</p></div>
            ) : sorted.length === 0 ? (
              <div className="empty-state"><Search size={40} /><p>{t('models.page.empty.noMatches')}</p></div>
            ) : (
              <>
                <div className="table-wrap" style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: 700 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>{thInner(t('models.page.columns.id'), 'id')}</th>
                        <th style={thStyle}>{thInner(t('models.page.columns.provider'), 'provider')}</th>
                        <th style={thStyle}>{thInner(t('models.page.columns.endpoint'), 'endpoint')}</th>
                        <th style={thStyle}>{thInner(t('models.page.columns.input'), 'input')}</th>
                        <th style={thStyle}>{thInner(t('models.page.columns.output'), 'output')}</th>
                        <th style={thStyle}>{thInner(t('models.page.columns.cache'), 'cache')}</th>
                        <th style={thStyle}>{thInner(t('models.page.columns.context'), 'context')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(m => (
                          <tr
                            key={m.id}
                            {...(canWriteModels ? {
                              style: { cursor: 'pointer' },
                              onClick: () => navigate(`/dashboard/models/${encodeURIComponent(m.id)}`),
                            } : {})}
                          >
                            <td><span className="mono">{m.id}</span></td>
                            <td><span className={`badge badge-${m.provider}`}>{providerLabel(m.provider)}</span></td>
                            <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.endpoint}</span></td>
                            <td>${m.cost.inputPerMillion}</td>
                            <td>${m.cost.outputPerMillion}</td>
                            <td>{m.cost.cachePerMillion != null ? `$${m.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                            <td>{m.contextWindow != null ? `${(m.contextWindow / 1000).toFixed(0)}k` : <span className="text-muted">—</span>}</td>
                            <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                              {(() => {
                                const tr = testResults[m.id];
                                if (tr === 'loading') return <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>…</span>;
                                if (tr) return (
                                  <span style={{ fontSize: '0.7rem', color: tr.ok ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }} title={tr.error}>
                                    {tr.ok ? `✓ ${tr.latencyMs}ms` : `✗ ${tr.error?.slice(0, 30)}`}
                                  </span>
                                );
                                return null;
                              })()}
                              <button className="btn-icon" onClick={() => handleTest(m.id)} title={t('models.page.actions.test')}>
                                <FlaskConical size={15} />
                              </button>
                              {canWriteModels && (
                                <>
                                  <Link to={`/dashboard/models/new?clone=${encodeURIComponent(m.id)}`} className="btn-icon" title={t('models.page.actions.clone')}>
                                    <Copy size={15} />
                                  </Link>
                                  <Link to={`/dashboard/models/${encodeURIComponent(m.id)}`} className="btn-icon" title={t('models.page.actions.edit')}>
                                    <Edit2 size={15} />
                                  </Link>
                                  <button className="btn-icon danger" onClick={() => handleDelete(m.id)} title={t('models.page.actions.remove')}>
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                    marginTop: 16, padding: '10px 0',
                  }}>
                    <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                      {t('models.page.pagination.previous')}
                    </button>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {t('models.page.pagination.pageOf', { page, totalPages })}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{t('models.page.pagination.total', { count: sorted.length })}</span>
                    </span>
                    <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                      {t('models.page.pagination.next')}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === 'health' && (
          loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : models.length === 0 ? (
            <div className="empty-state"><Server size={40} /><p>{t('models.page.health.emptyNoModels')}</p></div>
          ) : (
            <>
              <div className="toolbar">
                <span className="toolbar-title">
                  {hFiltered.length !== models.length
                    ? t('models.page.toolbar.filteredCount', { filtered: hFiltered.length, count: models.length })
                    : t('models.page.toolbar.count', { count: models.length })}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {canManage && (
                    <button className="btn btn-secondary" disabled={resetBusy !== null} onClick={confirmResetAll} title={t('models.page.health.resetAllTitle')}>
                      {resetBusy === 'all' ? <span className="spinner" /> : <><RotateCcw size={14} /> {t('models.page.health.resetAll')}</>}
                    </button>
                  )}
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                    <input
                      value={hSearch}
                      onChange={e => setHSearch(e.target.value)}
                      placeholder={t('models.page.filters.searchPlaceholder')}
                      style={{ paddingLeft: 28, paddingRight: hSearch ? 28 : 10, height: 32, fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 200 }}
                    />
                    {hSearch && (
                      <button onClick={() => setHSearch('')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {resetError && <div className="form-error" style={{ marginBottom: 16 }}>{resetError}</div>}
              {hSorted.length === 0 ? (
                <div className="empty-state"><Search size={40} /><p>{t('models.page.health.emptyNoMatches')}</p></div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {hTh(t('models.page.health.columns.model'), 'id')}
                          {hTh(t('models.page.health.columns.provider'), 'provider')}
                          {hTh(t('models.page.health.columns.status'), 'status')}
                          {hTh(t('models.page.health.columns.circuit'), 'circuit')}
                          {hTh(t('models.page.health.columns.errorRate'), 'errorRate', 'right')}
                          {hTh(t('models.page.health.columns.p95Latency'), 'p95Latency', 'right')}
                          {hTh(t('models.page.health.columns.requests'), 'requests', 'right')}
                          {hTh(t('models.page.health.columns.lastSuccess'), 'lastSuccess', 'right')}
                          {hTh(t('models.page.health.columns.cooldownLockout'), 'cooldown', 'right')}
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {hPaginated.map(m => {
                          const h = healthMap.get(m.id);
                          const cd = h ? cooldownTimer(h.cooldownUntil) : null;
                          const status: ExtendedStatus = h ? (cd ? 'cooldown' : h.status) : 'nodata';
                          return (
                            <tr key={m.id}>
                              <td><span className="mono">{m.id}</span></td>
                              <td><span className={`badge badge-${m.provider}`}>{providerLabel(m.provider)}</span></td>
                              <td><StatusBadge status={status} label={t(`models.page.health.status.${status}`)} /></td>
                              <td>
                                {h
                                  ? <span className={`badge ${CIRCUIT_BADGE[h.circuitState]}`}>{t(CIRCUIT_LABEL_KEY[h.circuitState])}</span>
                                  : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {h ? `${(h.errorRate * 100).toFixed(1)}%` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {h ? (h.p95LatencyMs == null ? '—' : `${Math.round(h.p95LatencyMs)} ms`) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {h ? h.requestsLastHour : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                {h ? relativeTime(h.lastSuccessAt, t) : '—'}
                              </td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                {(() => {
                                  if (!h) return '—';
                                  const parts: string[] = [];
                                  if (h.cooldownUntil && h.cooldownUntil > now) parts.push(t('models.page.health.time.cooldown', { time: formatCountdown(h.cooldownUntil, now, t) }));
                                  if (h.lockoutUntil && h.lockoutUntil > now) parts.push(t('models.page.health.time.lockout', { time: formatCountdown(h.lockoutUntil, now, t) }));
                                  return parts.length ? parts.join(', ') : '—';
                                })()}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {canManage && h && (
                                  <button
                                    className="btn-icon"
                                    disabled={resetBusy !== null}
                                    onClick={() => confirmResetModel(m)}
                                    title={t('models.page.health.resetTitle')}
                                  >
                                    {resetBusy === m.id ? <span className="spinner" /> : <RotateCcw size={15} />}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {hTotalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, padding: '10px 0' }}>
                      <button className="btn btn-sm btn-secondary" disabled={hPage <= 1} onClick={() => setHPage(p => Math.max(1, p - 1))}>
                        {t('models.page.pagination.previous')}
                      </button>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {t('models.page.pagination.pageOf', { page: hPage, totalPages: hTotalPages })}
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{t('models.page.pagination.total', { count: hSorted.length })}</span>
                      </span>
                      <button className="btn btn-sm btn-secondary" disabled={hPage >= hTotalPages} onClick={() => setHPage(p => p + 1)}>
                        {t('models.page.pagination.next')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )
        )}
      </div>
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}
