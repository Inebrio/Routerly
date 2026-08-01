import React, { useEffect, useMemo, useState } from 'react';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, DollarSign, XCircle, Boxes, FolderOpen, PiggyBank, Scissors, Terminal, Timer, TrendingUp } from 'lucide-react';
import { CLIENT_REGISTRY, type SavingsSummary } from '@routerly/shared';
import { getUsage, getModels, getProjects, type UsageStats } from '../api.js';
import { useClientsEnabled } from './ConnectPage.js';
import { ChartTooltip, TimeSeriesChart, axisProps, seriesColor, useChartTheme, type ChartSeries } from '../components/charts.js';
import { formatCost, formatDuration, formatTokens } from '../utils/traceUtils.js';

/** Model id without its provider prefix: what fits in a legend entry. */
const shortModel = (id: string): string => id.split('/').pop() ?? id;

/** What the savings chart is showing. */
type SavingsMetric = 'cost' | 'tokens' | 'speed';

const SAVINGS_METRIC_LABEL: Record<SavingsMetric, string> = { cost: 'Cost', tokens: 'Tokens', speed: 'Speed' };

/**
 * Axis ticks: a chart axis has no room for the eight decimals `formatCost` gives sub-cent
 * values, and a fixed three decimals collapses a whole sub-cent axis into repeated "$0.000".
 * Scale the decimals to the tick instead, so every tick stays distinct and inside the gutter.
 */
export const compactCost = (v: number): string => {
  if (!v) return '$0';
  const abs = Math.abs(v);
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(abs)))))}`;
};

const compactTokens = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

export function OverviewPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const [modelCount, setModelCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);
  const [savingsMetric, setSavingsMetric] = useState<SavingsMetric>('cost');
  const chartTheme = useChartTheme();

  useEffect(() => {
    // `series` carries the savings bucketed over time for the chart (T81),
    // `savings` the whole-window totals per baseline the saving cards read (T102).
    getUsage(period, undefined, undefined, undefined, undefined, undefined, { series: true, savings: true })
      .then(setStats).catch(() => setStatsError(true));
  }, [period]);

  useEffect(() => {
    getModels().then(m => setModelCount(m.length)).catch(console.error);
    getProjects().then(p => setProjectCount(p.length)).catch(console.error);
  }, []);

  const barData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byModel)
      .filter(([, v]) => v.cost > 0)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .slice(0, 8)
      .map(([name, v]) => {
        /* v8 ignore next */
        const shortName = name.split('/').pop() ?? name;
        return { name: shortName, fullName: name, value: v.cost };
      });
  }, [stats]);

  /**
   * One point per bucket, with the derived per-call figures the Speed metric
   * needs. Every paid baseline gets its own `b<i>` key rather than its model id:
   * recharts reads a dataKey containing a dot as a path, and model ids are full
   * of dots.
   */
  const savingsData = useMemo(() => {
    const series = stats?.series;
    if (!series) return [];
    return series.points.map(p => ({
      label: series.bucket === 'hour' ? `${p.bucket.slice(11)}:00` : p.bucket.slice(5),
      cost: p.cost,
      ...Object.fromEntries(series.baselineModelIds.map((id, i) => [`b${i}`, p.baselineCosts[id] ?? 0])),
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      /* v8 ignore next 2 — a bucket exists only because it has calls */
      latencyPerCall: p.calls > 0 ? Math.round(p.latencyMs / p.calls) : 0,
      baselineLatencyPerCall: p.calls > 0 ? Math.round(p.baselineLatencyMs / p.calls) : 0,
    }));
  }, [stats]);

  const sortedModels = useMemo(() =>
    stats ? Object.entries(stats.byModel).sort(([, a], [, b]) => b.calls - a.calls) : [],
    [stats],
  );

  const { totalIn, totalOut, totalCached } = useMemo(() => {
    let totalIn = 0, totalOut = 0, totalCached = 0;
    if (stats) {
      for (const v of Object.values(stats.byModel)) {
        totalIn += v.inputTokens;
        totalOut += v.outputTokens;
        totalCached += v.cachedInputTokens;
      }
    }
    return { totalIn, totalOut, totalCached };
  }, [stats]);

  if (!stats) {
    if (statsError) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No permission to view usage data.</div>;
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p>Usage summary and cost breakdown</p>
      </div>
      <div className="page-body">

        <ConnectCard />

        {/* Period selector — segmented control */}
        <div style={{ marginBottom: 24, display: 'inline-flex', alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 3, gap: 2 }}>
          {(['daily', 'weekly', 'monthly', 'all'] as const).map(p => (
            <button
              key={p}
              className={`theme-btn${period === p ? ' active' : ''}`}
              style={{ minWidth: 64 }}
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Stats grid */}
        <div className="stats-grid">
          <StatCard icon={<DollarSign size={18} />} label="Total Cost" accentColor="#3D75F5"
            value={`$${stats.summary.totalCost.toFixed(4)}`} sub="USD this period" to="/dashboard/usage" />
          <StatCard icon={<Activity size={18} />} label="Total Calls" accentColor="#5A90F8"
            value={stats.summary.totalCalls}
            sub={`${stats.summary.routingCalls} routing · ${stats.summary.completionCalls} completion`}
            to="/dashboard/usage" />
          <StatCard icon={<TrendingUp size={18} />} label="Success Rate" accentColor="#10B981"
            value={stats.summary.totalCalls > 0
              ? `${((stats.summary.successCalls / stats.summary.totalCalls) * 100).toFixed(1)}%`
              : '—'}
            sub="of all requests" to="/dashboard/usage" />
          <StatCard icon={<XCircle size={18} />} label="Errors" accentColor="#EF4444" valueColor="#EF4444"
            value={stats.summary.errorCalls} sub="failed requests" to="/dashboard/usage" />
          <StatCard icon={<Boxes size={18} />} label="Models" accentColor="#8B5CF6"
            value={modelCount} sub="registered" to="/dashboard/models" />
          <StatCard icon={<FolderOpen size={18} />} label="Projects" accentColor="#A78BFA"
            value={projectCount} sub="active" to="/dashboard/projects" />
          {stats.savings && <SavingsStats savings={stats.savings} />}
        </div>

        {/* Token aggregate strip */}
        {(totalIn > 0 || totalOut > 0) && (
          <div style={{ marginBottom: 20, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Input tokens: <strong style={{ color: 'var(--text-secondary)' }}>{totalIn.toLocaleString()}</strong></span>
            <span>·</span>
            <span>Output tokens: <strong style={{ color: 'var(--text-secondary)' }}>{totalOut.toLocaleString()}</strong></span>
            {totalCached > 0 && (
              <>
                <span>·</span>
                <span>Cached: <strong style={{ color: 'var(--text-secondary)' }}>{totalCached.toLocaleString()}</strong></span>
              </>
            )}
          </div>
        )}

        {/* What routing saved, over time (T81) */}
        {savingsData.length > 0 && (
          <SavingsCard
            key={period}
            data={savingsData}
            baselineIds={stats.series?.baselineModelIds ?? []}
            {...(stats.series?.baselineModelId ? { baselineModelId: stats.series.baselineModelId } : {})}
            {...(stats.savings ? { savings: stats.savings } : {})}
            metric={savingsMetric}
            onMetric={setSavingsMetric}
            period={period}
          />
        )}

        {/* Cost by model (bar) + Calls by model (table) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Horizontal bar chart — top models by cost */}
          <div className="chart-card" style={{ marginBottom: 0 }}>
            <h3>Cost by Model</h3>
            {barData.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', paddingTop: 8 }}>No cost recorded this period.</p>
            ) : (
              <ResponsiveContainer key={period} width="100%" height={Math.max(barData.length * 36, 120)}>
                <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 32 }}>
                  <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" {...axisProps(chartTheme)} tickFormatter={v => compactCost(Number(v))} />
                  <YAxis type="category" dataKey="name" {...axisProps(chartTheme)} width={110} />
                  <Tooltip
                    cursor={{ fill: chartTheme.cursor, fillOpacity: 0.12 }}
                    content={
                      <ChartTooltip
                        formatValue={v => formatCost(v)}
                        formatName={e => String(e.payload?.fullName ?? e.name ?? '')}
                        // The row already carries the full model id; the axis label would repeat it.
                        formatLabel={() => ''}
                      />
                    }
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {barData.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Calls by model table */}
          <div className="chart-card" style={{ marginBottom: 0 }}>
            <h3>Calls by Model</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Errors</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModels.map(([model, v]) => (
                    <tr key={model}>
                      <td><span className="mono">{model}</span></td>
                      <td style={{ textAlign: 'right' }}>{v.calls}</td>
                      <td style={{ textAlign: 'right', color: v.errors > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {v.errors > 0 ? v.errors : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>${v.cost.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

/**
 * The savings layer over time (T81): what the routed traffic cost, moved and
 * took, against what the same calls would have cost, moved and taken on the
 * costliest model the projects allow.
 *
 * The counterfactual is drawn dashed because it never happened. Tokens have no
 * counterfactual at all: the same conversation is assumed to produce the same
 * tokens everywhere, so only the price of those tokens changes.
 */
function SavingsCard({ data, baselineIds, baselineModelId, savings, metric, onMetric, period }: {
  data: Array<Record<string, string | number>>;
  /** Paid models the chart can price against, cheapest first. */
  baselineIds: string[];
  /** Costliest baseline: what the Speed counterfactual is estimated from. */
  baselineModelId?: string;
  savings?: SavingsSummary;
  metric: SavingsMetric;
  onMetric: (m: SavingsMetric) => void;
  period: string;
}) {
  // Cheapest and costliest are the two ends of the range, so those two start
  // visible; every other paid model waits in the legend, one click away (T100).
  // The default is derived at render, not seeded into state: the card mounts
  // before the first fetch answers, when baselineIds is still empty, and a
  // seeded set would keep that empty default forever and draw every line.
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const hiddenKeys = hidden ?? new Set(
    baselineIds.flatMap((_, i) => (i === 0 || i === baselineIds.length - 1 ? [] : [`b${i}`])),
  );
  const toggle = (key: string) => setHidden(() => {
    const next = new Set(hiddenKeys);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const hasBaselineLatency = (savings?.baselines[savings.baselines.length - 1]?.latencyMs ?? 0) > 0;

  const series: ChartSeries[] = (metric === 'tokens'
    ? [
      { key: 'inputTokens', label: 'Input', color: seriesColor(5) },
      { key: 'outputTokens', label: 'Output', color: seriesColor(1) },
    ]
    : metric === 'speed'
      ? [
        { key: 'latencyPerCall', label: 'Actual', color: seriesColor(0) },
        ...(hasBaselineLatency ? [{ key: 'baselineLatencyPerCall', label: `On ${shortModel(baselineModelId ?? '')}`, color: seriesColor(2), dashed: true }] : []),
      ]
      : [
        { key: 'cost', label: 'Actual', color: seriesColor(0) },
        ...baselineIds.map((id, i) => ({
          key: `b${i}`,
          label: shortModel(id),
          color: seriesColor(i + 1),
          dashed: true,
        })),
      ]
  // Every legend entry toggles, not just the baselines: the legend renders a
  // button for each series, and a button that does nothing is worse than none.
  ).map(s => ({ ...s, hidden: hiddenKeys.has(s.key) }));

  const formatValue = metric === 'cost' ? formatCost : metric === 'tokens' ? formatTokens : formatDuration;
  const formatAxis = metric === 'cost' ? compactCost : metric === 'tokens' ? compactTokens : formatDuration;

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div>
          <h3>What routing saved</h3>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {(savings?.comparedCalls ?? 0).toLocaleString()} client {savings?.comparedCalls === 1 ? 'call' : 'calls'}
            {baselineIds.length > 0 && (
              <>
                {', against sending them all to each of the '}
                <Link to="/dashboard/models" style={{ color: 'var(--accent)' }}>{baselineIds.length} paid models in play</Link>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 3, gap: 2 }}>
          {(['cost', 'tokens', 'speed'] as const).map(m => (
            <button
              key={m}
              className={`theme-btn${metric === m ? ' active' : ''}`}
              style={{ minWidth: 64 }}
              onClick={() => onMetric(m)}
            >
              {SAVINGS_METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <TimeSeriesChart
        key={`${period}-${metric}`}
        data={data}
        series={series}
        formatValue={formatValue}
        formatAxis={formatAxis}
        onToggleSeries={toggle}
      />
    </div>
  );
}

/**
 * What routing saved, as three more cards in the summary grid (T102).
 *
 * Every card is anchored on the same baseline: the costliest single model the
 * traffic could have gone to, which is the policy routing replaces. A min-max
 * range over every baseline was the first cut and it read as a verdict against
 * routing: its low end is always "sending everything to the cheapest model would
 * have cost less", true of any router and not what the card is asking. That end
 * is still shown, as the second line, where it reads as context instead.
 *
 * Money is exact arithmetic. Time comes from each model's own throughput in the
 * window, so a baseline that never answered carries none. Tokens are two things
 * kept apart on purpose: what the optimizers really cut, which is measured, and
 * what a different tokenizer would have counted, which is an estimate.
 */
function SavingsStats({ savings }: { savings: SavingsSummary }) {
  const paid = [...savings.baselines.filter(b => b.cost > 0)].sort((a, b) => a.costDelta - b.costDelta);
  if (paid.length === 0) return null;

  const anchor = paid[paid.length - 1]!;
  const cheapest = paid[0]!;
  const anchorName = shortModel(anchor.modelId);
  const optimizerTokens = savings.optimizers.reduce((sum, o) => sum + o.tokensSaved, 0);
  // The anchor is picked on price, so it need not be one of the models that
  // answered: the time card falls back to the costliest one that did.
  const timed = paid.filter(b => b.latencyDeltaMs !== undefined);
  const timeAnchor = timed[timed.length - 1];

  return (
    <>
      <StatCard icon={<PiggyBank size={18} />} label="Cost saved" accentColor="#10B981"
        valueColor={anchor.costDelta >= 0 ? '#10B981' : '#EF4444'}
        value={formatCost(anchor.costDelta)}
        sub={`vs always ${anchorName}`}
        {...(cheapest !== anchor
          ? { sub2: `${formatCost(cheapest.costDelta)} vs always ${shortModel(cheapest.modelId)}` }
          : {})}
      />
      <StatCard icon={<Timer size={18} />} label="Time saved" accentColor="#F59E0B"
        value={timeAnchor ? formatDuration(timeAnchor.latencyDeltaMs!) : '—'}
        sub={timeAnchor ? `vs always ${shortModel(timeAnchor.modelId)}` : 'no baseline answered in this window'}
      />
      <StatCard icon={<Scissors size={18} />} label="Tokens saved" accentColor="#8B5CF6"
        value={formatTokens(optimizerTokens)}
        sub="cut by optimizers, measured"
        sub2={`${formatTokens(anchor.tokenDelta)} vs always ${anchorName}, estimated`}
      />
    </>
  );
}

/**
 * Shortcut to the Connect section. Renders only while the client-configurator
 * module is enabled, same signal the sidebar entry uses.
 */
function ConnectCard() {
  const enabled = useClientsEnabled();
  if (!enabled) return null;

  return (
    <Link
      to="/dashboard/connect"
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, textDecoration: 'none', color: 'inherit' }}
    >
      <Terminal size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 2 }}>Connect a client</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Point Claude Code, Codex, Cursor and {CLIENT_REGISTRY.length - 3} more at this gateway.
        </div>
      </div>
      <ArrowRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </Link>
  );
}

function StatCard({ icon, label, value, sub, sub2, accentColor, valueColor, to }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: string;
  /** Second line, for a card whose number needs a counterweight to be read right. */
  sub2?: string;
  accentColor?: string;
  valueColor?: string;
  /** Section this number is explained in. The card becomes a link to it. */
  to?: string;
}) {
  /* v8 ignore next */
  const iconColor = accentColor || 'var(--accent)';
  const style = { '--stat-accent': accentColor } as React.CSSProperties;
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: iconColor }}>
        {icon}<span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="stat-sub">{sub}</div>
      {sub2 && <div className="stat-sub">{sub2}</div>}
    </>
  );

  return to
    ? <Link to={to} className="stat-card" style={style}>{body}</Link>
    : <div className="stat-card" style={style}>{body}</div>;
}
