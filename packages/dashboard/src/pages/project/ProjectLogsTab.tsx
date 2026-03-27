import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUsage, type UsageStats, type UsageRecord } from '../../api';
import { DateRangePicker, RECENT_PRESETS, type DateRange } from '../../components/DateRangePicker';
import { MultiSelect } from '../../components/MultiSelect';
import { useFilterState } from '../../hooks/useFilterState';

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.05em', color: 'var(--text-muted)',
    }}>
      {children}
    </span>
  );
}

export function ProjectLogsTab() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [stats, setStats]         = useState<UsageStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [dateRange, setDateRange] = useFilterState<DateRange>({ key: `project-${projectId}-filters-dateRange`, defaultValue: { from: '', to: '', label: 'This month' } });
  const [modelIds, setModelIds]   = useFilterState<string[]>({ key: `project-${projectId}-filters-modelIds`, defaultValue: [] });
  const [callTypeFilter, setCallTypeFilter] = useFilterState<'all' | 'completion' | 'routing'>({ key: `project-${projectId}-filters-callType`, defaultValue: 'all' });
  const [outcomeFilter, setOutcomeFilter]   = useFilterState<'all' | 'success' | 'error'>({ key: `project-${projectId}-filters-outcome`, defaultValue: 'all' });
  const [lastUpdated, setLastUpdated]       = useState<Date | null>(null);
  const [pollInterval, setPollInterval]     = useFilterState<number>({ key: `project-${projectId}-filters-pollInterval`, defaultValue: 30_000 });
  const [refreshing, setRefreshing]         = useState(false);
  const [page, setPage]                     = useState(1);
  const [pageSize]                          = useState(50);

  const POLL_OPTIONS: { label: string; value: number }[] = [
    { label: 'Off',  value: 0 },
    { label: '5s',   value: 5_000 },
    { label: '15s',  value: 15_000 },
    { label: '30s',  value: 30_000 },
    { label: '1m',   value: 60_000 },
    { label: '5m',   value: 300_000 },
  ];

  // Initialize date range to "This month" if not already set
  useEffect(() => {
    if (!dateRange.from && !dateRange.to) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateRange({
        from: start.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        label: 'This month',
      });
    }
  }, []);

  const fetchStats = useCallback(() => {
    if (!projectId) return Promise.resolve();
    // For recent (minutes/hours) presets, recalculate the range on every fetch
    let from = dateRange.from || undefined;
    let to = dateRange.to || undefined;
    const recentPreset = RECENT_PRESETS.find(p => p.label === dateRange.label);
    if (recentPreset) {
      const fresh = recentPreset.range();
      from = fresh.from;
      to = fresh.to;
    }
    const period = from || to ? 'custom' : 'all';
    return getUsage(period, projectId, from, to, page, pageSize)
      .then(data => { setStats(data); setLastUpdated(new Date()); })
      .catch(console.error);
  }, [projectId, dateRange, page, pageSize]);

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

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [dateRange, modelIds, callTypeFilter, outcomeFilter]);

  const modelOptions = useMemo(() => {
    if (!stats) return [];
    const ids = Array.from(new Set(stats.records.map(r => r.modelId))).sort();
    return ids.map(id => ({ value: id, label: id }));
  }, [stats]);

  const filteredRecords = useMemo<UsageRecord[]>(() => {
    if (!stats) return [];
    return stats.records.filter(r => {
      if (modelIds.length > 0 && !modelIds.includes(r.modelId)) return false;
      if (callTypeFilter !== 'all' && (r.callType ?? 'completion') !== callTypeFilter) return false;
      if (outcomeFilter !== 'all' && r.outcome !== outcomeFilter) return false;
      return true;
    });
  }, [stats, modelIds, callTypeFilter, outcomeFilter]);

  const hasReset = modelIds.length > 0 || callTypeFilter !== 'all' || outcomeFilter !== 'all';

  return (
    <div style={{ padding: '24px 0', maxWidth: 1100 }}>

      {/* ── Filters ── */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {pollInterval === 0
              ? 'Auto-refresh disabilitato'
              : `Auto-refresh ogni ${POLL_OPTIONS.find(o => o.value === pollInterval)?.label}`}
            {lastUpdated && <> &middot; ultimo aggiornamento: {lastUpdated.toLocaleTimeString()}</>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Refresh</span>
            {POLL_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`btn btn-sm ${pollInterval === o.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPollInterval(o.value)}
              >
                {o.label}
              </button>
            ))}
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleRefreshNow}
              disabled={refreshing}
              title="Aggiorna subito"
              style={{ marginLeft: 4 }}
            >
              {refreshing ? '…' : '↻ Now'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Period</FilterLabel>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
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
              {(['all', 'completion', 'routing'] as const).map(f => (
                <button
                  key={f}
                  className={`btn btn-sm ${callTypeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCallTypeFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'completion' ? 'Completion' : 'Router'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Status</FilterLabel>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'success', 'error'] as const).map(f => (
                <button
                  key={f}
                  className={`btn btn-sm ${outcomeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setOutcomeFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'success' ? 'Success' : 'Error'}
                </button>
              ))}
            </div>
          </div>

          {hasReset && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <FilterLabel>&nbsp;</FilterLabel>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => { setModelIds([]); setCallTypeFilter('all'); setOutcomeFilter('all'); }}
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !stats ? null : (
        <>
          {/* Summary strip */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-label">Total Cost</div>
              <div className="stat-value">${stats.summary.totalCost.toFixed(4)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Calls</div>
              <div className="stat-value">{stats.summary.totalCalls}</div>
            </div>
            <div
              className="stat-card"
              style={{ cursor: 'pointer', outline: callTypeFilter === 'completion' ? '2px solid var(--primary)' : 'none', outlineOffset: 2 }}
              onClick={() => setCallTypeFilter(f => f === 'completion' ? 'all' : 'completion')}
            >
              <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
                Completion Calls
              </div>
              <div className="stat-value">{stats.summary.completionCalls ?? stats.summary.totalCalls}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                ${(stats.summary.completionCost ?? stats.summary.totalCost).toFixed(4)}
              </div>
            </div>
            <div
              className="stat-card"
              style={{ cursor: 'pointer', outline: callTypeFilter === 'routing' ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}
              onClick={() => setCallTypeFilter(f => f === 'routing' ? 'all' : 'routing')}
            >
              <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                Router Calls
              </div>
              <div className="stat-value">{stats.summary.routingCalls ?? 0}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                ${(stats.summary.routingCost ?? 0).toFixed(4)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Errors</div>
              <div className="stat-value" style={{ color: stats.summary.errorCalls > 0 ? 'var(--danger)' : 'var(--success)' }}>
                {stats.summary.errorCalls}
              </div>
            </div>
          </div>

          {/* Records table */}
          <h3 style={{
            fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px',
          }}>
            Request Logs
            <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>
              ({stats.pagination ? `${filteredRecords.length} / ${stats.pagination.totalRecords}` : filteredRecords.length})
            </span>
          </h3>

          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <p>{stats.records.length === 0
                ? 'No requests for this project in the selected period.'
                : 'No records match the active filters.'}
              </p>
            </div>
          ) : (
            <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Model</th>
                    <th>Type</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Cost</th>
                    <th>Latency</th>
                    <th>TTFT</th>
                    <th>Tok/s</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r, i) => {
                    const isRouting = (r.callType ?? 'completion') === 'routing';
                    return (
                      <tr
                        key={i}
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/dashboard/usage/${r.id}`, { state: { record: r } })}
                      >
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {new Date(r.timestamp).toLocaleString()}
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
                        <td className="mono" style={{ fontSize: '0.78rem' }}>${r.cost.toFixed(6)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{r.latencyMs}ms</td>
                        <td style={{ color: 'var(--text-muted)' }}>{r.ttftMs != null ? `${r.ttftMs}ms` : '—'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{r.tokensPerSec != null ? `${r.tokensPerSec}` : '—'}</td>
                        <td>
                          <span className={`badge ${r.outcome === 'success' ? 'badge-success' : 'badge-error'}`}>
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
                  ← Precedente
                </button>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Pagina {stats.pagination.page} di {stats.pagination.totalPages}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                    ({stats.pagination.totalRecords} record totali)
                  </span>
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={page >= stats.pagination.totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Successiva →
                </button>
              </div>
            )}
            </>
          )}
        </>
      )}
    </div>
  );
}
