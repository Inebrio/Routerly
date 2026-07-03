import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Server, Edit2, Copy, ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Telescope } from 'lucide-react';
import { getModels, deleteModel, getProviderHealth, type Model, type ProviderHealth } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

type SortKey = 'id' | 'provider' | 'endpoint' | 'input' | 'output' | 'cache' | 'context'
  | 'status' | 'errorRate' | 'p95Latency' | 'requests' | 'lastSuccess' | 'cooldown';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 20;
const HEALTH_REFRESH_MS = 30_000;

function numOrInfinity(v: number | null | undefined) { return v ?? Infinity; }

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
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

const STATUS_META: Record<ExtendedStatus, { label: string; color: string }> = {
  healthy:     { label: 'Healthy',     color: 'var(--success)' },
  degraded:    { label: 'Degraded',    color: 'var(--warning)' },
  unavailable: { label: 'Unavailable', color: 'var(--danger)' },
  cooldown:    { label: 'Cooldown',    color: 'var(--text-muted)' },
  nodata:      { label: 'No data',     color: 'var(--text-muted)' },
};

function StatusBadge({ status }: { status: ExtendedStatus }) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: '0.8rem', fontWeight: 600, color: meta.color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} />
      {meta.label}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function cooldownTimer(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}

// ── Models page ────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'health' ? 'health' : 'models';
  function setTab(t: 'models' | 'health') {
    setSearchParams(t === 'health' ? { tab: 'health' } : {}, { replace: true });
  }

  const [models, setModels] = useState<Model[]>([]);
  const [healthMap, setHealthMap] = useState<Map<string, ProviderHealth>>(new Map());
  const [loading, setLoading] = useState(true);
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const healthActive = useRef(true);

  // Load models once
  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setModels(await getModels()); } finally { setLoading(false); }
  }

  // Load health + poll every 30s
  useEffect(() => {
    healthActive.current = true;
    async function fetchHealth() {
      try {
        const { providers } = await getProviderHealth();
        if (!healthActive.current) return;
        setHealthMap(new Map(providers.map(p => [p.modelId, p])));
        setHealthUpdatedAt(new Date());
      } catch {
        // health is best-effort; model list still shows
      }
    }
    fetchHealth();
    const id = setInterval(fetchHealth, HEALTH_REFRESH_MS);
    return () => { healthActive.current = false; clearInterval(id); };
  }, []);

  function handleDelete(id: string) {
    setConfirmState({
      message: `Remove model "${id}"?`,
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
  useEffect(() => { setPage(1); }, [search, providerFilter]);

  const providerOptions = useMemo(
    () => Array.from(new Set(models.map(m => m.provider))).sort(),
    [models],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter(m => {
      if (providerFilter && m.provider !== providerFilter) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.endpoint.toLowerCase().includes(q);
    });
  }, [models, search, providerFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ha = healthMap.get(a.id);
      const hb = healthMap.get(b.id);
      // For health columns: no-data rows always sink to bottom regardless of direction
      const isHealthKey = ['status', 'errorRate', 'p95Latency', 'requests', 'lastSuccess', 'cooldown'].includes(sortKey);
      if (isHealthKey) {
        const aNoData = !ha;
        const bNoData = !hb;
        if (aNoData && bNoData) return 0;
        if (aNoData) return 1;   // a sinks
        if (bNoData) return -1;  // b sinks
      }
      let cmp = 0;
      switch (sortKey) {
        case 'id':        cmp = a.id.localeCompare(b.id); break;
        case 'provider':  cmp = a.provider.localeCompare(b.provider); break;
        case 'endpoint':  cmp = a.endpoint.localeCompare(b.endpoint); break;
        case 'input':     cmp = a.cost.inputPerMillion - b.cost.inputPerMillion; break;
        case 'output':    cmp = a.cost.outputPerMillion - b.cost.outputPerMillion; break;
        case 'cache':     cmp = numOrInfinity(a.cost.cachePerMillion) - numOrInfinity(b.cost.cachePerMillion); break;
        case 'context':   cmp = numOrInfinity(a.contextWindow) - numOrInfinity(b.contextWindow); break;
        case 'status': {
          const sa: ExtendedStatus = ha ? (cooldownTimer(ha.cooldownUntil) ? 'cooldown' : ha.status) : 'nodata';
          const sb: ExtendedStatus = hb ? (cooldownTimer(hb.cooldownUntil) ? 'cooldown' : hb.status) : 'nodata';
          // nodata always last; for the rest, asc = best health first (healthy > degraded > cooldown > unavailable)
          if (sa === 'nodata' && sb === 'nodata') { cmp = 0; break; }
          if (sa === 'nodata') { cmp = 1; break; }
          if (sb === 'nodata') { cmp = -1; break; }
          cmp = STATUS_SEVERITY[sb] - STATUS_SEVERITY[sa]; // higher severity = worse, sorts last on asc
          break;
        }
        case 'errorRate':   cmp = (ha?.errorRate ?? Infinity) - (hb?.errorRate ?? Infinity); break;
        case 'p95Latency':  cmp = (ha?.p95LatencyMs ?? Infinity) - (hb?.p95LatencyMs ?? Infinity); break;
        case 'requests':    cmp = (ha?.requestsLastHour ?? Infinity) - (hb?.requestsLastHour ?? Infinity); break;
        case 'lastSuccess': {
          const ta = ha?.lastSuccessAt ? new Date(ha.lastSuccessAt).getTime() : -Infinity;
          const tb = hb?.lastSuccessAt ? new Date(hb.lastSuccessAt).getTime() : -Infinity;
          cmp = ta - tb;
          break;
        }
        case 'cooldown': {
          const ca = ha?.cooldownUntil ? new Date(ha.cooldownUntil).getTime() : 0;
          const cb = hb?.cooldownUntil ? new Date(hb.cooldownUntil).getTime() : 0;
          cmp = ca - cb;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, healthMap]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Clamp page when a delete removes the last row on the last page
  useEffect(() => { if (page > totalPages) setPage(Math.max(1, totalPages)); }, [page, totalPages]);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        <h1>Models</h1>
        <p>LLM providers registered with Routerly
          {healthUpdatedAt && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.82rem' }}>
              · health updated {relativeTime(healthUpdatedAt.toISOString())} (every 30s)
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginTop: 12 }}>
          <button style={tabStyle('models')} onClick={() => setTab('models')}>Models</button>
          <button style={tabStyle('health')} onClick={() => setTab('health')}>Health</button>
        </div>
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
        {tab === 'models' && (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {filtered.length !== models.length
                  ? `${filtered.length} of ${models.length} model${models.length !== 1 ? 's' : ''}`
                  : `${models.length} model${models.length !== 1 ? 's' : ''}`}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={providerFilter}
                  onChange={e => setProviderFilter(e.target.value)}
                  style={{
                    height: 32, padding: '0 10px', fontSize: '0.85rem', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
                    outline: 'none',
                  }}
                >
                  <option value="">All providers</option>
                  {providerOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Filter models…"
                    style={{ paddingLeft: 28, paddingRight: search ? 28 : 10, height: 32, fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 200 }}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <Link to="/dashboard/models/discover" className="btn">
                  <Telescope size={16} /> Discover
                </Link>
                <Link to="/dashboard/models/new" className="btn btn-primary">
                  <Plus size={16} /> Add Model
                </Link>
              </div>
            </div>
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : models.length === 0 ? (
              <div className="empty-state"><Server size={40} /><p>No models yet. Add one to get started.</p></div>
            ) : sorted.length === 0 ? (
              <div className="empty-state"><Search size={40} /><p>No models match the active filters.</p></div>
            ) : (
              <>
                <div className="table-wrap" style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: 1000 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>{thInner('ID', 'id')}</th>
                        <th style={thStyle}>{thInner('Provider', 'provider')}</th>
                        <th style={thStyle}>{thInner('Endpoint', 'endpoint')}</th>
                        <th style={thStyle}>{thInner('Input $/1M', 'input')}</th>
                        <th style={thStyle}>{thInner('Output $/1M', 'output')}</th>
                        <th style={thStyle}>{thInner('Cache $/1M', 'cache')}</th>
                        <th style={thStyle}>{thInner('Context Size', 'context')}</th>
                        <th style={thStyle}>{thInner('Status', 'status')}</th>
                        <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{thInner('Error rate (5m)', 'errorRate')}</th>
                        <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{thInner('P95 latency (1h)', 'p95Latency')}</th>
                        <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{thInner('Requests (1h)', 'requests')}</th>
                        <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{thInner('Last success', 'lastSuccess')}</th>
                        <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{thInner('Cooldown', 'cooldown')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(m => {
                        const h = healthMap.get(m.id);
                        const cd = h ? cooldownTimer(h.cooldownUntil) : null;
                        const status: ExtendedStatus = h ? (cd ? 'cooldown' : h.status) : 'nodata';
                        return (
                          <tr key={m.id}>
                            <td><span className="mono">{m.id}</span></td>
                            <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                            <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.endpoint}</span></td>
                            <td>${m.cost.inputPerMillion}</td>
                            <td>${m.cost.outputPerMillion}</td>
                            <td>{m.cost.cachePerMillion != null ? `$${m.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                            <td>{m.contextWindow != null ? `${(m.contextWindow / 1000).toFixed(0)}k` : <span className="text-muted">—</span>}</td>
                            <td><StatusBadge status={status} /></td>
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
                              {h ? relativeTime(h.lastSuccessAt) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                              {h ? (cd ?? '—') : '—'}
                            </td>
                            <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <Link to={`/dashboard/models/new?clone=${encodeURIComponent(m.id)}`} className="btn-icon" title="Clone">
                                <Copy size={15} />
                              </Link>
                              <Link to={`/dashboard/models/${encodeURIComponent(m.id)}`} className="btn-icon" title="Edit">
                                <Edit2 size={15} />
                              </Link>
                              <button className="btn-icon danger" onClick={() => handleDelete(m.id)} title="Remove">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                    marginTop: 16, padding: '10px 0',
                  }}>
                    <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                      ← Previous
                    </button>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Page {page} of {totalPages}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({sorted.length} models)</span>
                    </span>
                    <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                      Next →
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
            <div className="empty-state"><Server size={40} /><p>No models configured.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Provider</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Error rate (5m)</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>P95 latency (1h)</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Requests (1h)</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Last success</th>
                    <th style={{ textAlign: 'right' }}>Cooldown</th>
                  </tr>
                </thead>
                <tbody>
                  {[...models]
                    .sort((a, b) => {
                      const ha = healthMap.get(a.id);
                      const hb = healthMap.get(b.id);
                      const sa: ExtendedStatus = ha ? (cooldownTimer(ha.cooldownUntil) ? 'cooldown' : ha.status) : 'nodata';
                      const sb: ExtendedStatus = hb ? (cooldownTimer(hb.cooldownUntil) ? 'cooldown' : hb.status) : 'nodata';
                      const diff = STATUS_SEVERITY[sa] - STATUS_SEVERITY[sb];
                      return diff !== 0 ? diff : a.id.localeCompare(b.id);
                    })
                    .map(m => {
                      const h = healthMap.get(m.id);
                      const cd = h ? cooldownTimer(h.cooldownUntil) : null;
                      const status: ExtendedStatus = h ? (cd ? 'cooldown' : h.status) : 'nodata';
                      return (
                        <tr key={m.id}>
                          <td><span className="mono">{m.id}</span></td>
                          <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                          <td><StatusBadge status={status} /></td>
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
                            {h ? relativeTime(h.lastSuccessAt) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                            {h ? (cd ?? '—') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
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
