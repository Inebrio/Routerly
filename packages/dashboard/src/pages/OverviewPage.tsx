import React, { useEffect, useMemo, useState } from 'react';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, DollarSign, XCircle, Boxes, FolderOpen, Terminal, TrendingUp } from 'lucide-react';
import { CLIENT_REGISTRY } from '@routerly/shared';
import { getUsage, getModels, getProjects, type UsageStats } from '../api.js';
import { useClientsEnabled } from './ConnectPage.js';
import { ChartTooltip, TimeSeriesChart, axisProps, seriesColor, useChartTheme } from '../components/charts.js';
import { formatCost } from '../utils/traceUtils.js';

const PERIOD_LABEL: Record<string, string> = {
  daily: 'Cost per Hour (USD)',
  weekly: 'Cost per Week (USD)',
  monthly: 'Daily Cost (USD)',
  all: 'Cost over Time (USD)',
};

export function OverviewPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const [modelCount, setModelCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);
  const chartTheme = useChartTheme();

  useEffect(() => {
    getUsage(period).then(setStats).catch(() => setStatsError(true));
  }, [period]);

  useEffect(() => {
    getModels().then(m => setModelCount(m.length)).catch(console.error);
    getProjects().then(p => setProjectCount(p.length)).catch(console.error);
  }, []);

  const timelineData = useMemo(() => {
    if (!stats) return [];
    const isHourly = (stats.timeline[0]?.[0]?.length ?? 0) > 10;

    if (isHourly) {
      const costByHour = new Map<string, number>(stats.timeline.map(([d, c]) => [d, c]));
      const now = new Date();
      const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
      return Array.from({ length: 24 }, (_, h) => {
        const key = `${dateStr}T${String(h).padStart(2, '0')}`;
        return { date: `${String(h).padStart(2, '0')}:00`, cost: costByHour.get(key) ?? 0 };
      });
    }

    // Use period boundaries so weekly ≠ monthly when data is sparse
    const now = new Date();
    let start: Date;
    if (period === 'weekly') {
      start = new Date(now);
      const d = start.getDay();
      start.setDate(start.getDate() - (d === 0 ? 6 : d - 1));
      start.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'all' && stats.timeline.length > 0) {
      const firstKey = stats.timeline[0]![0]!;
      const [fy, fm, fd] = firstKey.split('-').map(Number) as [number, number, number];
      start = new Date(fy, fm - 1, fd);
    } else {
      return [];
    }

    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const costByDate = new Map<string, number>(stats.timeline.map(([d, c]) => [d, c]));
    const result: { date: string; cost: number }[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      result.push({ date: key.slice(5), cost: costByDate.get(key) ?? 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [stats, period]);

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
            value={`$${stats.summary.totalCost.toFixed(4)}`} sub="USD this period" />
          <StatCard icon={<Activity size={18} />} label="Total Calls" accentColor="#5A90F8"
            value={stats.summary.totalCalls}
            sub={`${stats.summary.routingCalls} routing · ${stats.summary.completionCalls} completion`} />
          <StatCard icon={<TrendingUp size={18} />} label="Success Rate" accentColor="#10B981"
            value={stats.summary.totalCalls > 0
              ? `${((stats.summary.successCalls / stats.summary.totalCalls) * 100).toFixed(1)}%`
              : '—'}
            sub="of all requests" />
          <StatCard icon={<XCircle size={18} />} label="Errors" accentColor="#EF4444" valueColor="#EF4444"
            value={stats.summary.errorCalls} sub="failed requests" />
          <StatCard icon={<Boxes size={18} />} label="Models" accentColor="#8B5CF6"
            value={modelCount} sub="registered" />
          <StatCard icon={<FolderOpen size={18} />} label="Projects" accentColor="#A78BFA"
            value={projectCount} sub="active" />
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

        {/* Cost timeline */}
        {timelineData.length > 0 && (
          <div className="chart-card">
            <h3>{PERIOD_LABEL[period]}</h3>
            <TimeSeriesChart
              key={period}
              data={timelineData}
              xKey="date"
              series={[{ key: 'cost', label: 'Cost', color: seriesColor(0) }]}
              formatValue={formatCost}
            />
          </div>
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
                  <XAxis type="number" {...axisProps(chartTheme)} tickFormatter={v => formatCost(Number(v))} />
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

function StatCard({ icon, label, value, sub, accentColor, valueColor }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: string;
  accentColor?: string;
  valueColor?: string;
}) {
  /* v8 ignore next */
  const iconColor = accentColor || 'var(--accent)';
  return (
    <div className="stat-card" style={{ '--stat-accent': accentColor } as React.CSSProperties}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: iconColor }}>
        {icon}<span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
