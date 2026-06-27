import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import { getUsage, getProjects, getLeaderboard, type UsageStats, type Project, type LeaderboardEntry } from '../api';
import { MultiSelect } from '../components/MultiSelect';
import { DateRangePicker, PRESETS, RECENT_PRESETS, type DateRange } from '../components/DateRangePicker';
import { useFilterState } from '../hooks/useFilterState';

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}

// ── Tab bar (reuses ProjectLayout visual style) ──────────────────────────────

function TabBar({ active, onChange }: { active: 'usage' | 'leaderboard'; onChange: (t: 'usage' | 'leaderboard') => void }) {
  const tabs: { id: 'usage' | 'leaderboard'; label: string }[] = [
    { id: 'usage', label: 'Usage' },
    { id: 'leaderboard', label: 'Leaderboard' },
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

// ── Leaderboard section ───────────────────────────────────────────────────────

const LEADERBOARD_PERIODS: { value: string; label: string }[] = [
  { value: 'daily',   label: 'Today' },
  { value: 'weekly',  label: 'This week' },
  { value: 'monthly', label: 'This month' },
];

function Sparkline({ trend }: { trend: LeaderboardEntry['trend'] }) {
  const w = 80, h = 22, pad = 2;
  const max = Math.max(...trend.map(t => t.cost), 0);
  if (max <= 0) {
    return <svg width={w} height={h} aria-label="No cost in range"><line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border)" strokeWidth={1} /></svg>;
  }
  const n = trend.length;
  const points = trend.map((t, i) => {
    const x = pad + (n === 1 ? 0 : (i * (w - pad * 2)) / (n - 1));
    const y = h - pad - (t.cost / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} aria-label="Daily cost, last 7 days">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function fmtCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function LeaderboardTab({ projects }: { projects: Project[] }) {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [period, setPeriod] = useState('monthly');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getLeaderboard(period, projectId || undefined)
      .then(data => { if (active) { setRows(data); setError(null); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Failed to load leaderboard'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, projectId]);

  const bestModelId = rows.find(r => r.successRate > 0)?.modelId ?? null;

  return (
    <div style={{ paddingTop: 24 }}>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Models ranked by cost-performance from your real traffic. Data is local — no external telemetry.
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {LEADERBOARD_PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '6px 14px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', border: 'none',
                background: period === p.value ? 'var(--accent)' : 'var(--bg-elevated)',
                color: period === p.value ? 'var(--accent-contrast, #fff)' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          style={{
            padding: '6px 12px', fontSize: '0.82rem', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          }}
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : error ? (
        <div className="empty-state" style={{ color: 'var(--danger)' }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No usage in the selected range.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'right' }}>Rank</th>
                <th>Model</th>
                <th>Provider</th>
                <th style={{ textAlign: 'right' }}>Requests</th>
                <th style={{ textAlign: 'right' }}>Success rate</th>
                <th style={{ textAlign: 'right' }}>Avg latency</th>
                <th style={{ textAlign: 'right' }}>P95 latency</th>
                <th style={{ textAlign: 'right' }}>Cost / 1K tokens</th>
                <th style={{ textAlign: 'right' }}>Total cost</th>
                <th style={{ textAlign: 'right' }}>Trend (7d)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isBest = r.modelId === bestModelId;
                return (
                  <tr key={r.modelId}>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {isBest && <Star size={13} fill="var(--warning)" color="var(--warning)" aria-label="Best cost-performance" />}
                        {r.modelId}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{r.provider}</td>
                    <td style={{ textAlign: 'right' }}>{r.totalRequests}</td>
                    <td style={{ textAlign: 'right' }}>{(r.successRate * 100).toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{Math.round(r.avgLatencyMs)} ms</td>
                    <td style={{ textAlign: 'right' }}>{Math.round(r.p95LatencyMs)} ms</td>
                    <td style={{ textAlign: 'right' }}>{fmtCost(r.avgCostPer1kTokens)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCost(r.totalCost)}</td>
                    <td style={{ textAlign: 'right' }}><Sparkline trend={r.trend} /></td>
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

// ── Main page ─────────────────────────────────────────────────────────────────

export function UsagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'usage' | 'leaderboard'>(
    searchParams.get('tab') === 'leaderboard' ? 'leaderboard' : 'usage'
  );

  function handleTabChange(tab: 'usage' | 'leaderboard') {
    setActiveTab(tab);
    if (tab === 'leaderboard') setSearchParams({ tab: 'leaderboard' }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  const [stats, setStats]               = useState<UsageStats | null>(null);
  const [projects, setProjects]         = useState<Project[]>([]);
  const [dateRange, setDateRange]       = useFilterState<DateRange>({ key: 'usage-filters-dateRange', defaultValue: { from: '', to: '', label: 'This month' } });
  const [projectIds, setProjectIds]     = useFilterState<string[]>({ key: 'usage-filters-projectIds', defaultValue: [] });
  const [modelIds, setModelIds]         = useFilterState<string[]>({ key: 'usage-filters-modelIds', defaultValue: [] });
  const [callTypeFilter, setCallTypeFilter] = useFilterState<'all' | 'completion' | 'routing' | 'guardrail'>({ key: 'usage-filters-callType', defaultValue: 'all' });
  const [outcomeFilter, setOutcomeFilter]   = useFilterState<'all' | 'success' | 'error' | 'blocked'>({ key: 'usage-filters-outcome', defaultValue: 'all' });
  const [loading, setLoading]           = useState(true);
  const [fetchError, setFetchError]     = useState<string | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [pollInterval, setPollInterval] = useFilterState<number>({ key: 'usage-filters-pollInterval', defaultValue: 30_000 });
  const [liveMode, setLiveMode]         = useState(false);
  const [refreshing, setRefreshing]     = useState(false);
  const [page, setPage]                 = useState(1);
  const [pageSize]                      = useState(100);
  const [newRowIds, setNewRowIds]       = useState<ReadonlySet<string>>(new Set());
  const latestTimestampRef              = useRef<string | null>(null);
  const navigate = useNavigate();

  const POLL_OPTIONS: { label: string; value: number }[] = [
    { label: 'Off',  value: 0 },
    { label: '5s',   value: 5_000 },
    { label: '15s',  value: 15_000 },
    { label: '30s',  value: 30_000 },
    { label: '1m',   value: 60_000 },
    { label: '5m',   value: 300_000 },
  ];

  const handleToggleLive = useCallback(() => {
    setLiveMode(prev => {
      const next = !prev;
      setPollInterval(next ? 2_000 : 30_000);
      return next;
    });
  }, [setPollInterval]);

  // Initialize date range to "This month" if not already set,
  // or re-apply stale relative presets (e.g. saved on a previous day).
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const isRecentPreset = RECENT_PRESETS.some(p => p.label === dateRange.label);
    if (isRecentPreset) return;

    if (!dateRange.from && !dateRange.to) {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      setDateRange({ from, to: today, label: 'This month' });
    } else if (dateRange.to && dateRange.to.slice(0, 10) < today) {
      const preset = PRESETS.find(p => p.label === dateRange.label);
      if (preset) setDateRange(preset.range());
    }
  }, []);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    latestTimestampRef.current = null;
    setNewRowIds(new Set());
  }, [dateRange, page, pageSize, projectIds, modelIds, callTypeFilter, outcomeFilter]);

  const fetchStats = useCallback(() => {
    const prevMax = latestTimestampRef.current;
    let from = dateRange.from || undefined;
    let to = dateRange.to || undefined;
    const recentPreset = RECENT_PRESETS.find(p => p.label === dateRange.label);
    if (recentPreset) {
      const fresh = recentPreset.range();
      from = fresh.from;
      to = fresh.to;
    }
    const period = from || to ? 'custom' : 'all';
    return getUsage(period, undefined, from, to, page, pageSize)
      .then(data => {
        if (prevMax !== null) {
          const ids = new Set(data.records.filter(r => r.timestamp > prevMax).map(r => r.id));
          if (ids.size > 0) {
            setNewRowIds(ids);
            setTimeout(() => setNewRowIds(new Set()), 3_000);
          }
        }
        const maxTs = data.records.reduce<string>((max, r) => r.timestamp > max ? r.timestamp : max, '');
        if (maxTs) latestTimestampRef.current = maxTs;

        setStats(data);
        setLastUpdated(new Date());
        setFetchError(null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setFetchError(msg);
        console.error('Failed to load usage stats:', msg);
      });
  }, [dateRange, page, pageSize]);

  const handleRefreshNow = useCallback(() => {
    setRefreshing(true);
    fetchStats().finally(() => setRefreshing(false));
  }, [fetchStats]);

  useEffect(() => {
    setLoading(true);
    fetchStats().finally(() => setLoading(false));
    if (pollInterval === 0) return;
    const id = setInterval(fetchStats, pollInterval);
    return () => clearInterval(id);
  }, [fetchStats, pollInterval]);

  useEffect(() => { setPage(1); }, [dateRange, projectIds, modelIds, callTypeFilter, outcomeFilter]);

  const modelOptions = useMemo(() => {
    if (!stats) return [];
    const ids = Array.from(new Set(stats.records.map(r => r.modelId))).sort();
    return ids.map(id => ({ value: id, label: id }));
  }, [stats]);

  const projectOptions = useMemo(
    () => projects.map(p => ({ value: p.id, label: p.name })),
    [projects],
  );

  const filteredRecords = useMemo(() => {
    if (!stats) return [];
    return stats.records.filter(r => {
      if (projectIds.length > 0 && !projectIds.includes(r.projectId)) return false;
      if (modelIds.length > 0 && !modelIds.includes(r.modelId)) return false;
      if (callTypeFilter !== 'all' && (r.callType ?? 'completion') !== callTypeFilter) return false;
      if (outcomeFilter !== 'all' && r.outcome !== outcomeFilter) return false;
      return true;
    });
  }, [stats, projectIds, modelIds, callTypeFilter, outcomeFilter]);

  const hasActiveFilters = projectIds.length > 0 || modelIds.length > 0 || callTypeFilter !== 'all' || outcomeFilter !== 'all';
  const hasReset = hasActiveFilters;

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>
          Usage
          {liveMode && activeTab === 'usage' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
              padding: '3px 10px', borderRadius: 99, marginLeft: 12,
              background: 'rgba(239,68,68,0.12)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.35)',
              verticalAlign: 'middle',
              animation: 'live-pulse 2s ease-in-out infinite',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              LIVE
            </span>
          )}
        </h1>
        <p>
          Detailed call logs, per-model breakdown, and model performance ranking
          {activeTab === 'usage' && lastUpdated && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 12 }}>
              · updated at {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {activeTab === 'usage' && (
            <span style={{ marginLeft: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {POLL_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`btn btn-sm ${!liveMode && pollInterval === o.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setLiveMode(false); setPollInterval(o.value); }}
                  disabled={liveMode}
                >
                  {o.label}
                </button>
              ))}
              <button
                className={`btn btn-sm ${liveMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={handleToggleLive}
                style={{
                  marginLeft: 4,
                  ...(liveMode ? { background: '#ef4444', borderColor: '#ef4444', color: 'white' } : {}),
                }}
                title={liveMode ? 'Disable live mode' : 'Enable live mode (refresh every 2s)'}
              >
                ● Live
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleRefreshNow}
                disabled={refreshing}
                title="Refresh now"
                style={{ marginLeft: 4 }}
              >
                {refreshing ? '…' : '↻ Now'}
              </button>
            </span>
          )}
        </p>

        <TabBar active={activeTab} onChange={handleTabChange} />
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
        {activeTab === 'leaderboard' ? (
          <LeaderboardTab projects={projects} />
        ) : (
          <>
            {/* Filters */}
            <div className="card" style={{ padding: '14px 18px', marginBottom: 20, position: 'relative', zIndex: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <FilterLabel>Period</FilterLabel>
                  <DateRangePicker value={dateRange} onChange={setDateRange} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 200 }}>
                  <FilterLabel>Project</FilterLabel>
                  <MultiSelect
                    options={projectOptions}
                    value={projectIds}
                    onChange={setProjectIds}
                    placeholder="All Projects"
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 200 }}>
                  <FilterLabel>Model</FilterLabel>
                  <MultiSelect
                    options={modelOptions}
                    value={modelIds}
                    onChange={setModelIds}
                    placeholder="All Models"
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <FilterLabel>Type</FilterLabel>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['all', 'completion', 'routing', 'guardrail'] as const).map(f => (
                      <button key={f} className={`btn btn-sm ${callTypeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setCallTypeFilter(f)}>
                        {f === 'all' ? 'All' : f === 'completion' ? 'Completion' : f === 'routing' ? 'Router' : 'Guardrail'}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <FilterLabel>Status</FilterLabel>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['all', 'success', 'blocked', 'error'] as const).map(f => (
                      <button key={f} className={`btn btn-sm ${outcomeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setOutcomeFilter(f)}>
                        {f === 'all' ? 'All' : f === 'success' ? 'Success' : f === 'blocked' ? 'Blocked' : 'Error'}
                      </button>
                    ))}
                  </div>
                </div>

                {hasReset && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <FilterLabel>&nbsp;</FilterLabel>
                    <button className="btn btn-sm btn-secondary"
                      onClick={() => { setProjectIds([]); setModelIds([]); setCallTypeFilter('all'); setOutcomeFilter('all'); }}>
                      Reset filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : fetchError ? (
              <div className="empty-state" style={{ color: 'var(--danger)' }}>
                <p>Failed to load usage data: <strong>{fetchError}</strong></p>
                <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={handleRefreshNow}>Retry</button>
              </div>
            ) : !stats ? null : (
              <>
                {/* Summary */}
                <div className="stats-grid" style={{ marginBottom: 24 }}>
                  <div className="stat-card">
                    <div className="stat-label">Total Cost</div>
                    <div className="stat-value">${stats.summary.totalCost.toFixed(4)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Total Calls</div>
                    <div className="stat-value">{stats.summary.totalCalls}</div>
                  </div>
                  <div className="stat-card" style={{ cursor: 'pointer', outline: callTypeFilter === 'completion' ? '2px solid var(--primary)' : 'none', outlineOffset: 2 }}
                    onClick={() => setCallTypeFilter(f => f === 'completion' ? 'all' : 'completion')}>
                    <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
                      Completion Calls
                    </div>
                    <div className="stat-value">{stats.summary.completionCalls ?? stats.summary.totalCalls}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>${(stats.summary.completionCost ?? stats.summary.totalCost).toFixed(4)}</div>
                  </div>
                  <div className="stat-card" style={{ cursor: 'pointer', outline: callTypeFilter === 'routing' ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}
                    onClick={() => setCallTypeFilter(f => f === 'routing' ? 'all' : 'routing')}>
                    <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                      Router Calls
                    </div>
                    <div className="stat-value">{stats.summary.routingCalls ?? 0}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>${(stats.summary.routingCost ?? 0).toFixed(4)}</div>
                  </div>
                  {(stats.summary.guardrailCalls ?? 0) > 0 && (
                    <div className="stat-card">
                      <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                        Guardrail Calls
                      </div>
                      <div className="stat-value">{stats.summary.guardrailCalls}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>${(stats.summary.guardrailCost ?? 0).toFixed(4)}</div>
                    </div>
                  )}
                  {(stats.summary.blockedCalls ?? 0) > 0 && (
                    <div className="stat-card">
                      <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning, #f59e0b)', display: 'inline-block' }} />
                        Blocked Calls
                      </div>
                      <div className="stat-value">{stats.summary.blockedCalls}</div>
                    </div>
                  )}
                  <div className="stat-card">
                    <div className="stat-label">Errors</div>
                    <div className="stat-value" style={{ color: stats.summary.errorCalls > 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {stats.summary.errorCalls}
                    </div>
                  </div>
                </div>

                {/* Per-model table */}
                {Object.keys(stats.byModel).length > 0 && (
                  <div className="table-wrap" style={{ marginBottom: 24 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Model</th><th>Calls</th><th>Errors</th>
                          <th>Input Tokens</th><th>Output Tokens</th><th>Cost (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(stats.byModel).map(([model, v]) => (
                          <tr key={model}>
                            <td><span className="mono">{model}</span></td>
                            <td>{v.calls}</td>
                            <td style={{ color: v.errors > 0 ? 'var(--danger)' : 'inherit' }}>{v.errors}</td>
                            <td>{v.inputTokens.toLocaleString()}</td>
                            <td>{v.outputTokens.toLocaleString()}</td>
                            <td className="mono">${v.cost.toFixed(8)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Recent calls */}
                <>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
                    Recent Calls
                    <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>
                      ({stats.pagination ? `${filteredRecords.length} / ${stats.pagination.totalRecords}` : filteredRecords.length})
                    </span>
                  </h3>

                  {filteredRecords.length === 0 ? (
                    <div className="empty-state">
                      <p>{stats.records.length === 0 ? 'No usage records for this period.' : 'No records match the active filters.'}</p>
                    </div>
                  ) : (
                    <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th><th>Project</th><th>Model</th><th>Type</th><th>In</th><th>Out</th>
                            <th>Cost</th><th>Latency</th><th>TTFT</th><th>Tok/s</th><th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRecords.map((r) => {
                            const isRouting = (r.callType ?? 'completion') === 'routing';
                            const isNew = liveMode && newRowIds.has(r.id);
                            return (
                              <tr
                                key={r.id}
                                className={isNew ? 'row-new' : undefined}
                                style={{
                                  cursor: 'pointer',
                                  borderLeft: isRouting
                                    ? '3px solid var(--accent)'
                                    : '3px solid var(--primary)',
                                }}
                                onClick={() => navigate(`/dashboard/usage/${r.id}`, { state: { record: r } })}
                              >
                                <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  {new Date(r.timestamp).toLocaleString()}
                                </td>
                                <td style={{ fontSize: '0.78rem' }}>
                                  {projects.find(p => p.id === r.projectId)?.name ?? <span className="mono" style={{ fontSize: '0.72rem' }}>{r.projectId}</span>}
                                </td>
                                <td><span className="mono" style={{ fontSize: '0.78rem' }}>{r.modelId}</span></td>
                                <td>
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    fontSize: '0.72rem', fontWeight: 600, padding: '2px 7px',
                                    borderRadius: 99,
                                    background: isRouting ? 'rgba(99,102,241,0.12)' : 'rgba(59,130,246,0.12)',
                                    color: isRouting ? 'var(--accent)' : 'var(--primary)',
                                  }}>
                                    {isRouting ? 'router' : 'completion'}
                                  </span>
                                </td>
                                <td>{r.inputTokens}</td>
                                <td>{r.outputTokens}</td>
                                <td className="mono" style={{ fontSize: '0.78rem' }}>${r.cost.toFixed(8)}</td>
                                <td style={{ color: 'var(--text-muted)' }}>{r.latencyMs}ms</td>
                                <td style={{ color: 'var(--text-muted)' }}>{r.ttftMs != null ? `${r.ttftMs}ms` : '—'}</td>
                                <td style={{ color: 'var(--text-muted)' }}>{r.tokensPerSec != null ? `${r.tokensPerSec}` : '—'}</td>
                                <td>
                                  <span className={`badge ${r.outcome === 'success' ? 'badge-success' : r.outcome === 'blocked' ? 'badge-warning' : 'badge-error'}`}>
                                    {r.outcome}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination controls */}
                    {stats.pagination && stats.pagination.totalPages > 1 && (
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
                          Page {stats.pagination.page} of {stats.pagination.totalPages}
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                            ({stats.pagination.totalRecords} total records)
                          </span>
                        </span>
                        <button
                          className="btn btn-sm btn-secondary"
                          disabled={page >= stats.pagination.totalPages}
                          onClick={() => setPage(p => p + 1)}
                        >
                          Next →
                        </button>
                      </div>
                    )}
                    </>
                  )}
                </>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
