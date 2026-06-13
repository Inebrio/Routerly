import React, { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { Activity, DollarSign, XCircle, Boxes, FolderOpen, TrendingUp } from 'lucide-react';
import { getUsage, getModels, getProjects, type UsageStats } from '../api.js';
import { useTheme } from '../ThemeContext.js';

const PALETTE = ['#3d75f5', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316'];

const PERIOD_LABEL: Record<string, string> = {
  daily: 'Cost per Hour (USD)',
  weekly: 'Cost per Week (USD)',
  monthly: 'Daily Cost (USD)',
  all: 'Cost over Time (USD)',
};

export function OverviewPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [period, setPeriod] = useState('monthly');
  const [modelCount, setModelCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);
  const { theme } = useTheme();

  const isDark = theme === 'dark' || (theme === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  const tickColor = isDark ? '#94a3b8' : '#475569';

  useEffect(() => {
    getUsage(period).then(setStats).catch(console.error);
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
      .map(([name, v]) => ({ name: name.split('/').pop() ?? name, fullName: name, value: v.cost }));
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

  if (!stats) return <div className="loading-center"><div className="spinner" /></div>;

  const tooltipStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p>Usage summary and cost breakdown</p>
      </div>
      <div className="page-body">

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
            <h3>{PERIOD_LABEL[period] ?? 'Cost over Time (USD)'}</h3>
            <ResponsiveContainer key={period} width="100%" height={200}>
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5A90F8" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#5A90F8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: tickColor }}
                  formatter={(v) => [`$${(v as number).toFixed(8)}`, 'Cost']} />
                <Area type="monotone" dataKey="cost" stroke="#5A90F8" fill="url(#grad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
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
                  <XAxis type="number" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `$${(v as number).toFixed(4)}`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false}
                    tickLine={false} width={110} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: tickColor }}
                    formatter={(v, _, p) => [`$${(v as number).toFixed(8)}`, p.payload.fullName]} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {barData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]!} />)}
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

function StatCard({ icon, label, value, sub, accentColor, valueColor }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: string;
  accentColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="stat-card" style={{ '--stat-accent': accentColor } as React.CSSProperties}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: accentColor || 'var(--accent)' }}>
        {icon}<span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
