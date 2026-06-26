import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Server, Edit2, Copy, ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Telescope } from 'lucide-react';
import { getModels, deleteModel, getProviderHealth, type Model, type ProviderHealth } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

type SortKey = 'id' | 'provider' | 'input' | 'output' | 'cache' | 'context';
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

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: 'models' | 'health'; onChange: (t: 'models' | 'health') => void }) {
  const tabs: { id: 'models' | 'health'; label: string }[] = [
    { id: 'models', label: 'Models' },
    { id: 'health', label: 'Health' },
  ];
  return (
    <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '0 4px 12px',
            fontSize: '0.9rem',
            fontWeight: 500,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: active === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: active === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -1,
            transition: 'all 0.2s',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Health tab ────────────────────────────────────────────────────────────────

const STATUS_META: Record<ProviderHealth['status'], { label: string; color: string }> = {
  healthy:     { label: 'Healthy',     color: 'var(--success)' },
  degraded:    { label: 'Degraded',    color: 'var(--warning)' },
  unavailable: { label: 'Unavailable', color: 'var(--danger)' },
  cooldown:    { label: 'Cooldown',    color: 'var(--text-muted)' },
};

function StatusBadge({ status }: { status: ProviderHealth['status'] }) {
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

function HealthTab() {
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { providers } = await getProviderHealth();
        if (!active) return;
        setProviders(providers);
        setUpdatedAt(new Date());
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load health');
      } finally {
        if (active && !didInit.current) { setLoading(false); didInit.current = true; }
      }
    }
    load();
    const id = setInterval(load, HEALTH_REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  return (
    <div style={{ paddingTop: 24 }}>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Real-time operational status per model{' '}
        {updatedAt && <span style={{ color: 'var(--text-muted)' }}>· updated {relativeTime(updatedAt.toISOString())}</span>}
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>(auto-refreshes every 30s)</span>
      </p>
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : error ? (
        <div className="empty-state" style={{ color: 'var(--danger)' }}>{error}</div>
      ) : providers.length === 0 ? (
        <div className="empty-state">No models configured.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Error rate (5m)</th>
                <th style={{ textAlign: 'right' }}>P95 latency (5m)</th>
                <th style={{ textAlign: 'right' }}>Requests (1h)</th>
                <th style={{ textAlign: 'right' }}>Last success</th>
                <th style={{ textAlign: 'right' }}>Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(p => {
                const cd = cooldownTimer(p.cooldownUntil);
                return (
                  <tr key={p.modelId}>
                    <td>{p.name || p.modelId}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.provider}</td>
                    <td><StatusBadge status={cd ? 'cooldown' : p.status} /></td>
                    <td style={{ textAlign: 'right' }}>{(p.errorRate * 100).toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{p.p95LatencyMs == null ? '—' : `${Math.round(p.p95LatencyMs)} ms`}</td>
                    <td style={{ textAlign: 'right' }}>{p.requestsLastHour}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{relativeTime(p.lastSuccessAt)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{cd ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Models tab ────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'models' | 'health'>(
    searchParams.get('tab') === 'health' ? 'health' : 'models'
  );

  function handleTabChange(tab: 'models' | 'health') {
    setActiveTab(tab);
    if (tab === 'health') setSearchParams({ tab: 'health' }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setModels(await getModels()); } finally { setLoading(false); }
  }

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
      let cmp = 0;
      switch (sortKey) {
        case 'id':       cmp = a.id.localeCompare(b.id); break;
        case 'provider': cmp = a.provider.localeCompare(b.provider); break;
        case 'input':    cmp = a.cost.inputPerMillion - b.cost.inputPerMillion; break;
        case 'output':   cmp = a.cost.outputPerMillion - b.cost.outputPerMillion; break;
        case 'cache':    cmp = numOrInfinity(a.cost.cachePerMillion) - numOrInfinity(b.cost.cachePerMillion); break;
        case 'context':  cmp = numOrInfinity(a.contextWindow) - numOrInfinity(b.contextWindow); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

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

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>Models</h1>
        <p style={{ marginBottom: 16 }}>LLM providers registered with Routerly</p>
        <TabBar active={activeTab} onChange={handleTabChange} />
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
        {activeTab === 'health' ? (
          <HealthTab />
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {filtered.length !== models.length
                  ? `${filtered.length} of ${models.length} model${models.length !== 1 ? 's' : ''}`
                  : `${models.length} model${models.length !== 1 ? 's' : ''}`}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Provider filter */}
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
                {/* Search */}
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
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={thStyle}>{thInner('ID', 'id')}</th>
                        <th style={thStyle}>{thInner('Provider', 'provider')}</th>
                        <th>Endpoint</th>
                        <th style={thStyle}>{thInner('Input $/1M', 'input')}</th>
                        <th style={thStyle}>{thInner('Output $/1M', 'output')}</th>
                        <th style={thStyle}>{thInner('Cache $/1M', 'cache')}</th>
                        <th style={thStyle}>{thInner('Context Size', 'context')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(m => (
                        <tr key={m.id}>
                          <td><span className="mono">{m.id}</span></td>
                          <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                          <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.endpoint}</span></td>
                          <td>${m.cost.inputPerMillion}</td>
                          <td>${m.cost.outputPerMillion}</td>
                          <td>{m.cost.cachePerMillion != null ? `$${m.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                          <td>{m.contextWindow != null ? `${(m.contextWindow / 1000).toFixed(0)}k` : <span className="text-muted">—</span>}</td>
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
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                    marginTop: 16, padding: '10px 0',
                  }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      ← Previous
                    </button>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Page {page} of {totalPages}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                        ({sorted.length} models)
                      </span>
                    </span>
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </>
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
