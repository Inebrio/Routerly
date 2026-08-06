import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { CALL_TYPES, REQUEST_TYPES, requestTypeLabel, type RequestType } from '@routerly/shared';
import { getUsage, getRouters, getModels, type UsageStats, type Router, type Model } from '../api';
import { MultiSelect } from '../components/MultiSelect';
import { DateRangePicker, PRESETS, RECENT_PRESETS, parseStoredRange, type DateRange } from '../components/DateRangePicker';
import { CostCard, SavingsCard, TokensCard, savingsSeriesData, type SavingsMetric } from '../components/savings';
import { useFilterState } from '../hooks/useFilterState';
import { tokenLabel } from '../utils/tokenLabel';
import { useProviderLabels } from '../hooks/useProviderLabels';
import { isCaptureMode } from '../utils/captureMode';

type ModelSortKey = 'rank' | 'model' | 'provider' | 'calls' | 'errors' | 'successRate'
  | 'avgLatency' | 'p95Latency' | 'inputTokens' | 'outputTokens' | 'costPer1k' | 'cost';

/** Rows the model ranking shows before it has to be expanded. */
const MODEL_ROWS_COLLAPSED = 10;
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: ModelSortKey; sortKey: ModelSortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35, marginLeft: 4, flexShrink: 0 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />
    : <ChevronDown size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />;
}

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

/**
 * A single call costs a fraction of a cent, and eight fixed decimals turn the
 * column into a wall of zeros. Three significant digits keep the number
 * readable and still non-zero down to a millionth of a dollar.
 */
function fmtCallCost(n: number): string {
  if (!n) return '$0';
  if (n < 0.000001) return '<$0.000001';
  return `$${Number(n.toPrecision(3))}`;
}

/** Who made the call: the client, or Routerly on its own behalf (routing, guardrail, experiment judge). */
const CALLER_FILTER_LABELS = { all: 'All', completion: 'Completion', routing: 'Router', guardrail: 'Guardrail', judge: 'Judge' } as const;
const CALLER_BADGE_LABELS = { completion: 'completion', routing: 'router', guardrail: 'guardrail', judge: 'judge' } as const;
/** Only the calls Routerly makes on its own behalf are colour-coded: most rows
 *  are completions, so badging those too would just tint the whole table. */
const CALLER_COLORS: Record<string, string> = { routing: 'var(--accent)', guardrail: '#ef4444', judge: 'var(--warning)' };

/** Numbers read as a column only when they are right-aligned and same-width. */
const numTh: React.CSSProperties = { textAlign: 'right' };
const numTd: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/** The window the page opens on, taken from the presets so label and dates agree. */
const THIS_MONTH = PRESETS.find(p => p.label === 'This month');
const ALL_TIME: DateRange = { from: '', to: '', label: 'All time' };

// ── Main page ─────────────────────────────────────────────────────────────────

export function UsagePage() {
  const providerLabel = useProviderLabels();
  const [stats, setStats]               = useState<UsageStats | null>(null);
  const [routers, setRouters]         = useState<Router[]>([]);
  const [allModels, setAllModels]       = useState<Model[]>([]);
  // "This month" is the default, and it has to arrive as a real range: an empty
  // one used to be filled in on mount, which overwrote a stored "All time" on
  // every reload and lost the filter the user had picked.
  const [dateRange, setDateRange]       = useFilterState<DateRange>({ key: 'usage-filters-dateRange', defaultValue: THIS_MONTH?.range() ?? ALL_TIME, deserialize: parseStoredRange });
  const [routerIds, setRouterIds]     = useFilterState<string[]>({ key: 'usage-filters-routerIds', defaultValue: [] });
  const [modelIds, setModelIds]         = useFilterState<string[]>({ key: 'usage-filters-modelIds', defaultValue: [] });
  const [tokenIds, setTokenIds]         = useFilterState<string[]>({ key: 'usage-filters-tokenIds', defaultValue: [] });
  const [callTypeFilter, setCallTypeFilter] = useFilterState<'all' | 'completion' | 'routing' | 'guardrail' | 'judge'>({ key: 'usage-filters-callType', defaultValue: 'all' });
  const [requestTypeFilter, setRequestTypeFilter] = useFilterState<'all' | RequestType>({ key: 'usage-filters-requestType', defaultValue: 'all' });
  const [outcomeFilter, setOutcomeFilter]   = useFilterState<'all' | 'success' | 'error' | 'blocked'>({ key: 'usage-filters-outcome', defaultValue: 'all' });
  // The savings layer rides a fetch of its own: the counterfactual is expensive
  // and the record table polls every 2s, so it follows the filters and nothing
  // else (T209).
  const [savingsStats, setSavingsStats] = useState<UsageStats | null>(null);
  const [savingsMetric, setSavingsMetric] = useFilterState<SavingsMetric>({ key: 'usage-filters-savingsMetric', defaultValue: 'cost' });
  const [loading, setLoading]           = useState(true);
  const [fetchError, setFetchError]     = useState<string | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [pollInterval, setPollInterval] = useFilterState<number>({ key: 'usage-filters-pollInterval', defaultValue: 2_000 });
  // Live mode and the poll interval are two halves of one choice, so they are
  // remembered together: restoring one without the other showed "30s" selected
  // while the page was really polling every 2s.
  const [liveMode, setLiveMode]         = useFilterState<boolean>({ key: 'usage-filters-liveMode', defaultValue: true });
  const [refreshing, setRefreshing]     = useState(false);
  const [page, setPage]                 = useState(1);
  const [pageSize]                      = useState(100);
  const [modelSortKey, setModelSortKey] = useFilterState<ModelSortKey>({ key: 'usage-filters-modelSortKey', defaultValue: 'rank' });
  const [modelSortDir, setModelSortDir] = useFilterState<SortDir>({ key: 'usage-filters-modelSortDir', defaultValue: 'asc' });
  const [newRowIds, setNewRowIds]       = useState<ReadonlySet<string>>(new Set());
  // A gateway with many models makes this ranking longer than the page: it opens
  // on the head of the current sort and expands on demand.
  const [showAllModels, setShowAllModels] = useState(false);
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

  // A relative preset stored yesterday still says "This month" but holds
  // yesterday's dates: re-apply it so the label and the window agree again.
  // Anything else the user picked, custom range or All time, is left alone.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (RECENT_PRESETS.some(p => p.label === dateRange.label)) return;
    if (!dateRange.to || dateRange.to.slice(0, 10) >= today) return;
    const preset = PRESETS.find(p => p.label === dateRange.label);
    if (preset) setDateRange(preset.range());
  }, []);

  useEffect(() => {
    getRouters().then(setRouters).catch(console.error);
    // ponytail: fetch stable model list once for filter options so the dropdown
    // does not collapse when a model filter is active (server-filtered records
    // would otherwise shrink the option list)
    getModels().then(setAllModels).catch(console.error);
  }, []);

  useEffect(() => {
    latestTimestampRef.current = null;
    setNewRowIds(new Set());
  }, [dateRange, page, pageSize, routerIds, modelIds, tokenIds, callTypeFilter, requestTypeFilter, outcomeFilter]);

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
      routerIds,
      modelIds,
      tokenIds,
      callType: callTypeFilter,
      requestType: requestTypeFilter,
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
  }, [dateRange, page, pageSize, routerIds, modelIds, tokenIds, callTypeFilter, requestTypeFilter, outcomeFilter]);

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

  useEffect(() => { setPage(1); }, [dateRange, routerIds, modelIds, tokenIds, callTypeFilter, requestTypeFilter, outcomeFilter]);

  // Savings over the same window and the same filters, one page of records asked
  // for because only the aggregates are read here (T209).
  useEffect(() => {
    let from = dateRange.from || undefined;
    let to = dateRange.to || undefined;
    const recentPreset = RECENT_PRESETS.find(p => p.label === dateRange.label);
    if (recentPreset) {
      const fresh = recentPreset.range();
      from = fresh.from;
      to = fresh.to;
    }
    const period = from || to ? 'custom' : 'all';
    getUsage(period, undefined, from, to, 1, 1, {
      routerIds,
      modelIds,
      tokenIds,
      callType: callTypeFilter,
      requestType: requestTypeFilter,
      outcome: outcomeFilter,
      series: true,
      savings: true,
    })
      .then(setSavingsStats)
      .catch(() => setSavingsStats(null));
  }, [dateRange, routerIds, modelIds, tokenIds, callTypeFilter, requestTypeFilter, outcomeFilter]);

  const savingsData = useMemo(() => savingsSeriesData(savingsStats?.series), [savingsStats]);

  // Both type filters are built from what the window actually holds (T210): the
  // static lists offered nine buttons where the traffic had two, and a filter
  // whose every button but one returns nothing is noise. A filter still renders
  // while it is set, otherwise picking the only value would hide the way back.
  const callerOptions = useMemo(
    () => CALL_TYPES.filter(t => (stats?.byCallType?.[t] ?? 0) > 0),
    [stats],
  );
  const requestTypeOptions = useMemo(
    () => REQUEST_TYPES.filter(t => (stats?.byRequestType?.[t] ?? 0) > 0),
    [stats],
  );

  // ponytail: model options sourced from getModels() (stable, unfiltered) so
  // the dropdown does not shrink when a model filter is active
  const modelOptions = useMemo(
    () => allModels.map(m => ({ value: m.id, label: m.id })),
    [allModels],
  );

  const routerOptions = useMemo(
    () => routers.map(p => ({ value: p.id, label: p.name })),
    [routers],
  );

  // Tokens are named per client, so filtering by one answers "what is this caller
  // doing" without the caller sending anything. Scoped to the selected routers
  // when there are any, otherwise the list is every token the gateway knows.
  const tokenOptions = useMemo(() => {
    const scope = routerIds.length > 0 ? routers.filter(p => routerIds.includes(p.id)) : routers;
    return scope.flatMap(p =>
      (p.tokens ?? []).map(t => ({
        value: t.id,
        label: routerIds.length === 1 ? tokenLabel(t) : `${p.name} / ${tokenLabel(t)}`,
      })),
    );
  }, [routers, routerIds]);

  /** Token name by id, for the caller shown under each call's router. */
  const tokenNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of routers) for (const t of p.tokens ?? []) map[t.id] = tokenLabel(t);
    return map;
  }, [routers]);

  // Server now filters; records are already consistent with active filters.
  const displayRecords = stats?.records ?? [];

  const hasActiveFilters = routerIds.length > 0 || modelIds.length > 0 || tokenIds.length > 0 || callTypeFilter !== 'all' || requestTypeFilter !== 'all' || outcomeFilter !== 'all';
  const hasReset = hasActiveFilters;

  function handleModelSort(key: ModelSortKey) {
    if (key === modelSortKey) setModelSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setModelSortKey(key); setModelSortDir('asc'); }
  }

  // Compute stable rank (cost-performance) over the full byModel set once.
  // rank metric = costPer1k / successRate; lower = better. Missing data → last.
  const rankedRows = useMemo(() => {
    if (!stats) return [];
    const entries = Object.entries(stats.byModel).map(([modelId, v]) => {
      const totalTok = v.inputTokens + v.outputTokens;
      const successRate = v.calls > 0 ? v.success / v.calls : 0;
      const costPer1k = totalTok > 0 ? (v.cost * 1000) / totalTok : Infinity;
      // metric: lower is better; Infinity for zero-success or zero-token models
      const metric = successRate > 0 && totalTok > 0 ? costPer1k / successRate : Infinity;
      // ponytail: authoritative source first; split fallback only for slash-ids
      const provider: string = allModels.find(m => m.id === modelId)?.provider
        ?? (modelId.includes('/') ? (modelId.split('/')[0] ?? modelId) : modelId);
      return { modelId, v, totalTok, successRate, costPer1k, metric, provider };
    });
    // Stable sort by metric to assign rank (ties share the same rank)
    const sorted = [...entries].sort((a, b) => a.metric - b.metric);
    let rank = 1;
    sorted.forEach((row, i) => {
      if (i > 0 && row.metric !== sorted[i - 1]!.metric) rank = i + 1;
      (row as typeof row & { rank: number }).rank = row.metric === Infinity ? Infinity : rank;
    });
    return entries.map(row => ({
      ...row,
      rank: (row as typeof row & { rank: number }).rank,
    }));
  }, [stats, allModels]);

  // The summary carries no token totals, but the per-model breakdown does, and it
  // covers exactly the same filtered window: adding it up is the whole widget.
  const tokenTotals = useMemo(() => {
    const rows = Object.values(stats?.byModel ?? {});
    return {
      input: rows.reduce((sum, v) => sum + v.inputTokens, 0),
      output: rows.reduce((sum, v) => sum + v.outputTokens, 0),
      cached: rows.reduce((sum, v) => sum + v.cachedInputTokens, 0),
    };
  }, [stats]);

  // Best = rank 1 (lowest metric among finite ranks)
  const bestModelId = useMemo(() => {
    const best = rankedRows.find(r => r.rank === 1);
    return best?.modelId ?? null;
  }, [rankedRows]);

  const sortedModelRows = useMemo(() => {
    return [...rankedRows].sort((a, b) => {
      // missing/Infinity values always sink to bottom regardless of direction
      const sentinel = (v: number) => v === Infinity || isNaN(v) ? Infinity : v;
      const strOrLast = (s: string) => s;
      let cmp = 0;
      switch (modelSortKey) {
        case 'rank':         cmp = sentinel(a.rank) - sentinel(b.rank); break;
        case 'model':        cmp = strOrLast(a.modelId).localeCompare(strOrLast(b.modelId)); break;
        case 'provider':     cmp = a.provider.localeCompare(b.provider); break;
        case 'calls':        cmp = a.v.calls - b.v.calls; break;
        case 'errors':       cmp = a.v.errors - b.v.errors; break;
        case 'successRate':  cmp = a.successRate - b.successRate; break;
        case 'avgLatency':   cmp = a.v.avgLatencyMs - b.v.avgLatencyMs; break;
        case 'p95Latency':   cmp = a.v.p95LatencyMs - b.v.p95LatencyMs; break;
        case 'inputTokens':  cmp = a.v.inputTokens - b.v.inputTokens; break;
        case 'outputTokens': cmp = a.v.outputTokens - b.v.outputTokens; break;
        case 'costPer1k':    cmp = sentinel(a.costPer1k) - sentinel(b.costPer1k); break;
        case 'cost':         cmp = a.v.cost - b.v.cost; break;
      }
      // For numeric sentinels: Infinity rows always sink to bottom
      if (modelSortKey !== 'model' && modelSortKey !== 'provider') {
        const aInf = sentinel(
          modelSortKey === 'rank' ? a.rank :
          modelSortKey === 'costPer1k' ? a.costPer1k : 0
        ) === Infinity;
        const bInf = sentinel(
          modelSortKey === 'rank' ? b.rank :
          modelSortKey === 'costPer1k' ? b.costPer1k : 0
        ) === Infinity;
        if (aInf && bInf) return 0;
        if (aInf) return 1;
        if (bInf) return -1;
      }
      return modelSortDir === 'asc' ? cmp : -cmp;
    });
  }, [rankedRows, modelSortKey, modelSortDir]);

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Usage
              {liveMode && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
                  padding: '3px 10px', borderRadius: 99,
                  background: 'rgba(239,68,68,0.12)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.35)',
                  animation: 'live-pulse 2s ease-in-out infinite',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                  LIVE
                </span>
              )}
            </h1>
            <p style={{ margin: 0 }}>
              Detailed call logs and per-model breakdown
              {lastUpdated && (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                  {/* Fixed placeholder while capturing documentation screenshots: the real
                      clock is wall-clock derived and differs between two runs of the same
                      commit. See ../utils/captureMode. */}
                  · updated at {isCaptureMode() ? '12:00:00 PM' : lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingTop: 4 }}>
            {POLL_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`btn btn-sm ${!liveMode && pollInterval === o.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setLiveMode(false); setPollInterval(o.value); }}
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
          </div>
        </div>
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
              <FilterLabel>Router</FilterLabel>
              <MultiSelect
                options={routerOptions}
                value={routerIds}
                onChange={setRouterIds}
                placeholder="All Routers"
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

            {(tokenOptions.length > 1 || tokenIds.length > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 200 }}>
                <FilterLabel>Token</FilterLabel>
                <MultiSelect
                  options={tokenOptions}
                  value={tokenIds}
                  onChange={setTokenIds}
                  placeholder="All Tokens"
                />
              </div>
            )}

            {(callerOptions.length > 1 || callTypeFilter !== 'all') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <FilterLabel>Caller</FilterLabel>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(['all', ...callerOptions] as const).map(f => (
                    <button key={f} className={`btn btn-sm ${callTypeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setCallTypeFilter(f)}>
                      {CALLER_FILTER_LABELS[f]}
                      {f !== 'all' && <span style={{ opacity: 0.6, marginLeft: 5 }}>{stats?.byCallType?.[f] ?? 0}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(requestTypeOptions.length > 1 || requestTypeFilter !== 'all') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <FilterLabel>Type</FilterLabel>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(['all', ...requestTypeOptions] as const).map(f => (
                    <button key={f} className={`btn btn-sm ${requestTypeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setRequestTypeFilter(f)}>
                      {f === 'all' ? 'All' : requestTypeLabel(f)}
                      {f !== 'all' && <span style={{ opacity: 0.6, marginLeft: 5 }}>{stats?.byRequestType?.[f] ?? 0}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                  onClick={() => { setRouterIds([]); setModelIds([]); setTokenIds([]); setCallTypeFilter('all'); setRequestTypeFilter('all'); setOutcomeFilter('all'); }}>
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
              {/* Same reading as the Overview: what routing saved belongs to the
                  number it changed, not to a card of its own (T201/T209). */}
              <CostCard totalCost={stats.summary.totalCost} {...(savingsStats?.savings ? { savings: savingsStats.savings } : {})} />
              <TokensCard inputTokens={tokenTotals.input} outputTokens={tokenTotals.output} cachedTokens={tokenTotals.cached}
                {...(savingsStats?.savings ? { savings: savingsStats.savings } : {})} />
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

            {/* What routing saved over the filtered window, the same chart the Overview carries (T209) */}
            {savingsData.length > 0 && (
              <SavingsCard
                key={dateRange.label}
                data={savingsData}
                baselineIds={savingsStats?.series?.baselineModelIds ?? []}
                {...(savingsStats?.savings ? { savings: savingsStats.savings } : {})}
                metric={savingsMetric}
                onMetric={setSavingsMetric}
                resetKey={dateRange.label}
              />
            )}

            {/* Per-model table — enriched with performance columns + Rank */}
            {sortedModelRows.length > 0 && (() => {
              const hidden = sortedModelRows.length - MODEL_ROWS_COLLAPSED;
              const visibleRows = showAllModels ? sortedModelRows : sortedModelRows.slice(0, MODEL_ROWS_COLLAPSED);
              const thS: React.CSSProperties = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
              const th = (label: string, key: ModelSortKey, align?: 'right') => (
                <th style={align ? { ...thS, textAlign: align } : thS}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : undefined }}
                    onClick={() => handleModelSort(key)}>
                    {label}<SortIcon col={key} sortKey={modelSortKey} sortDir={modelSortDir} />
                  </span>
                </th>
              );
              return (
                <div className="table-wrap" style={{ marginBottom: 24 }}>
                  <table>
                    <thead>
                      <tr>
                        {th('Rank', 'rank')}
                        {th('Model', 'model')}
                        {th('Provider', 'provider')}
                        {th('Calls', 'calls', 'right')}
                        {th('Errors', 'errors', 'right')}
                        {th('Success rate', 'successRate', 'right')}
                        {th('Avg latency', 'avgLatency', 'right')}
                        {th('P95 latency', 'p95Latency', 'right')}
                        {th('Input tokens', 'inputTokens', 'right')}
                        {th('Output tokens', 'outputTokens', 'right')}
                        {th('Cost / 1K', 'costPer1k', 'right')}
                        {th('Cost (USD)', 'cost', 'right')}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(({ modelId, v, totalTok, successRate, costPer1k, rank, provider }) => {
                        const isBest = modelId === bestModelId;
                        const displayRank = rank === Infinity ? '—' : String(rank);
                        return (
                          <tr key={modelId}>
                            <td style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                              {isBest
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <Star size={13} fill="var(--warning)" color="var(--warning)" aria-label="Best cost-performance" />
                                    {displayRank}
                                  </span>
                                : displayRank}
                            </td>
                            <td><span className="mono">{modelId}</span></td>
                            <td style={{ color: 'var(--text-secondary)' }}>{providerLabel(provider)}</td>
                            <td style={{ textAlign: 'right' }}>{v.calls}</td>
                            <td style={{ textAlign: 'right', color: v.errors > 0 ? 'var(--danger)' : 'inherit' }}>{v.errors}</td>
                            <td style={{ textAlign: 'right' }}>{(successRate * 100).toFixed(1)}%</td>
                            <td style={{ textAlign: 'right' }}>{Math.round(v.avgLatencyMs)} ms</td>
                            <td style={{ textAlign: 'right' }}>{Math.round(v.p95LatencyMs)} ms</td>
                            <td style={{ textAlign: 'right' }}>{v.inputTokens.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }}>{v.outputTokens.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }} className="mono">
                              {totalTok > 0 ? fmtCost(costPer1k) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td style={{ textAlign: 'right' }} className="mono">{fmtCallCost(v.cost ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllModels(v => !v)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', justifyContent: 'center', background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500, padding: '8px 0' }}
                    >
                      <ChevronDown size={14} style={{ transform: showAllModels ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                      {showAllModels ? 'Show fewer models' : `Show ${hidden} more model${hidden !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              );
            })()}

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
                        <th>Time</th><th>Router</th><th>Model</th><th>Type</th><th>Caller</th>
                        <th style={numTh}>In</th><th style={numTh}>Out</th><th style={numTh}>Cost</th>
                        <th style={numTh}>Latency</th><th style={numTh}>TTFT</th><th style={numTh}>Tok/s</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRecords.map((r) => {
                        // Records written before callType existed were all completions.
                        const caller = r.callType ?? 'completion';
                        const callerColor = CALLER_COLORS[caller];
                        const isNew = liveMode && newRowIds.has(r.id);
                        return (
                          <tr
                            key={r.id}
                            className={isNew ? 'row-new' : undefined}
                            style={{
                              cursor: 'pointer',
                              borderLeft: `3px solid ${callerColor ?? 'transparent'}`,
                            }}
                            onClick={() => navigate(`/dashboard/usage/${r.id}`, { state: { record: r } })}
                          >
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              {new Date(r.timestamp).toLocaleString()}
                            </td>
                            <td style={{ fontSize: '0.78rem' }}>
                              {routers.find(p => p.id === r.routerId)?.name ?? <span className="mono" style={{ fontSize: '0.72rem' }}>{r.routerId}</span>}
                              {r.tokenId && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  {tokenNames[r.tokenId] ?? r.tokenId}
                                </div>
                              )}
                            </td>
                            <td><span className="mono" style={{ fontSize: '0.78rem' }}>{r.modelId}</span></td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              {/* Records written before requestType existed were all chat calls. */}
                              {requestTypeLabel(r.requestType ?? 'chat')}
                            </td>
                            <td>
                              {callerColor ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  fontSize: '0.72rem', fontWeight: 600, padding: '2px 7px',
                                  borderRadius: 99,
                                  background: 'var(--bg-surface)',
                                  color: callerColor,
                                }}>
                                  {CALLER_BADGE_LABELS[caller]}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                  {CALLER_BADGE_LABELS[caller]}
                                </span>
                              )}
                            </td>
                            <td style={numTd}>{r.inputTokens}</td>
                            <td style={numTd}>{r.outputTokens}</td>
                            <td className="mono" style={{ ...numTd, fontSize: '0.78rem' }}>{fmtCallCost(r.cost ?? 0)}</td>
                            <td style={{ ...numTd, color: 'var(--text-muted)' }}>{r.latencyMs}ms</td>
                            <td style={{ ...numTd, color: 'var(--text-muted)' }}>{r.ttftMs != null ? `${r.ttftMs}ms` : '—'}</td>
                            <td style={{ ...numTd, color: 'var(--text-muted)' }}>{r.tokensPerSec != null ? `${r.tokensPerSec}` : '—'}</td>
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
