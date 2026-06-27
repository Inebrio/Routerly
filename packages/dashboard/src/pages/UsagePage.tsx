import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { getUsage, getProjects, getModels, type UsageStats, type Project, type Model } from '../api';
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

function fmtCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function UsagePage() {
  const [stats, setStats]               = useState<UsageStats | null>(null);
  const [projects, setProjects]         = useState<Project[]>([]);
  const [allModels, setAllModels]       = useState<Model[]>([]);
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
    // ponytail: fetch stable model list once for filter options so the dropdown
    // does not collapse when a model filter is active (server-filtered records
    // would otherwise shrink the option list)
    getModels().then(setAllModels).catch(console.error);
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
    return getUsage(period, undefined, from, to, page, pageSize, {
      projectIds,
      modelIds,
      callType: callTypeFilter,
      outcome: outcomeFilter,
    })
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
  }, [dateRange, page, pageSize, projectIds, modelIds, callTypeFilter, outcomeFilter]);

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

  // ponytail: model options sourced from getModels() (stable, unfiltered) so
  // the dropdown does not shrink when a model filter is active
  const modelOptions = useMemo(
    () => allModels.map(m => ({ value: m.id, label: m.id })),
    [allModels],
  );

  const projectOptions = useMemo(
    () => projects.map(p => ({ value: p.id, label: p.name })),
    [projects],
  );

  // Server now filters; records are already consistent with active filters.
  const displayRecords = stats?.records ?? [];

  const hasActiveFilters = projectIds.length > 0 || modelIds.length > 0 || callTypeFilter !== 'all' || outcomeFilter !== 'all';
  const hasReset = hasActiveFilters;

  // Best model by cost/1k among those with any success (mirrors old leaderboard highlight)
  const bestModelId = useMemo(() => {
    if (!stats) return null;
    let best: string | null = null;
    let bestCost = Infinity;
    for (const [modelId, v] of Object.entries(stats.byModel)) {
      if (v.success <= 0) continue;
      const totalTok = v.inputTokens + v.outputTokens;
      const costPer1k = totalTok > 0 ? (v.cost * 1000) / totalTok : Infinity;
      if (costPer1k < bestCost) { bestCost = costPer1k; best = modelId; }
    }
    return best;
  }, [stats]);

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>
          Usage
          {liveMode && (
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
          Detailed call logs and per-model breakdown
          {lastUpdated && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 12 }}>
              · updated at {lastUpdated.toLocaleTimeString()}
            </span>
          )}
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
        </p>
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
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

            {/* Per-model table — enriched with performance columns */}
            {Object.keys(stats.byModel).length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 24 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Provider</th>
                      <th style={{ textAlign: 'right' }}>Calls</th>
                      <th style={{ textAlign: 'right' }}>Errors</th>
                      <th style={{ textAlign: 'right' }}>Success rate</th>
                      <th style={{ textAlign: 'right' }}>Avg latency</th>
                      <th style={{ textAlign: 'right' }}>P95 latency</th>
                      <th style={{ textAlign: 'right' }}>Input tokens</th>
                      <th style={{ textAlign: 'right' }}>Output tokens</th>
                      <th style={{ textAlign: 'right' }}>Cost / 1K</th>
                      <th style={{ textAlign: 'right' }}>Cost (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats.byModel).map(([modelId, v]) => {
                      const isBest = modelId === bestModelId;
                      const totalTok = v.inputTokens + v.outputTokens;
                      // ponytail: guard divide-by-zero; guard v.calls=0
                      const successRate = v.calls > 0 ? (v.success / v.calls) * 100 : 0;
                      const costPer1k = totalTok > 0 ? (v.cost * 1000) / totalTok : 0;
                      const provider = modelId.split('/')[0];
                      return (
                        <tr key={modelId}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {isBest && <Star size={13} fill="var(--warning)" color="var(--warning)" aria-label="Best cost-performance" />}
                              <span className="mono">{modelId}</span>
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>{provider}</td>
                          <td style={{ textAlign: 'right' }}>{v.calls}</td>
                          <td style={{ textAlign: 'right', color: v.errors > 0 ? 'var(--danger)' : 'inherit' }}>{v.errors}</td>
                          <td style={{ textAlign: 'right' }}>{successRate.toFixed(1)}%</td>
                          <td style={{ textAlign: 'right' }}>{Math.round(v.avgLatencyMs)} ms</td>
                          <td style={{ textAlign: 'right' }}>{Math.round(v.p95LatencyMs)} ms</td>
                          <td style={{ textAlign: 'right' }}>{v.inputTokens.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>{v.outputTokens.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {totalTok > 0 ? fmtCost(costPer1k) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">${v.cost.toFixed(8)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recent calls */}
            <>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
                Recent Calls
                <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>
                  ({stats.pagination ? `${displayRecords.length} / ${stats.pagination.totalRecords}` : displayRecords.length})
                </span>
              </h3>

              {displayRecords.length === 0 ? (
                <div className="empty-state">
                  <p>No usage records for this period.</p>
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
                      {displayRecords.map((r) => {
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
                      Previous
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
                      Next
                    </button>
                  </div>
                )}
                </>
              )}
            </>
          </>
        )}
      </div>
    </>
  );
}
