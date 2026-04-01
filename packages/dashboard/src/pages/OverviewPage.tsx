import React, { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Activity, DollarSign, CheckCircle, XCircle } from 'lucide-react';
import { getUsage, getModels, getProjects, type UsageStats } from '../api';

const PALETTE = ['#3d75f5', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6'];

export function OverviewPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [period, setPeriod] = useState('monthly');
  const [modelCount, setModelCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);

  useEffect(() => {
    getUsage(period).then(setStats).catch(console.error);
  }, [period]);

  useEffect(() => {
    getModels().then(m => setModelCount(m.length)).catch(console.error);
    getProjects().then(p => setProjectCount(p.length)).catch(console.error);
  }, []);

  if (!stats) return <div className="loading-center"><div className="spinner" /></div>;

  const pieData = Object.entries(stats.byModel).map(([name, v]) => ({ name, value: v.cost }));
  const timelineData = stats.timeline.map(([date, cost]) => ({
    date: date.slice(5), cost: Number(cost.toFixed(6)),
  }));

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p>Usage summary and cost breakdown</p>
      </div>
      <div className="page-body">
        {/* Period selector */}
        <div style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
          {(['daily', 'weekly', 'monthly', 'all'] as const).map(p => (
            <button
              key={p}
              className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Stats grid */}
        <div className="stats-grid">
          <StatCard icon={<DollarSign size={18} />} label="Total Cost" accentColor="#3D75F5" value={`$${stats.summary.totalCost.toFixed(4)}`} sub="USD this period" />
          <StatCard icon={<Activity size={18} />} label="Total Calls" accentColor="#5A90F8" value={stats.summary.totalCalls} sub={`${stats.summary.successCalls} succeeded`} />
          <StatCard icon={<CheckCircle size={18} />} label="Success Rate" accentColor="#10B981" value={
            stats.summary.totalCalls > 0
              ? `${((stats.summary.successCalls / stats.summary.totalCalls) * 100).toFixed(1)}%`
              : '—'
          } sub="of all requests" />
          <StatCard icon={<XCircle size={18} />} label="Errors" accentColor="#EF4444" valueColor="#EF4444" value={stats.summary.errorCalls} sub="failed requests" />
          <StatCard icon={<Activity size={18} />} label="Models" accentColor="#8B5CF6" value={modelCount} sub="registered" />
          <StatCard icon={<Activity size={18} />} label="Projects" accentColor="#A78BFA" value={projectCount} sub="active" />
        </div>

        {/* Cost timeline */}
        {timelineData.length > 0 && (
          <div className="chart-card">
            <h3>Daily Cost (USD)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5A90F8" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#5A90F8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  formatter={(v) => [`$${(v as number).toFixed(6)}`, 'Cost']}
                />
                <Area type="monotone" dataKey="cost" stroke="#5A90F8" fill="url(#grad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cost by model */}
        {pieData.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="chart-card">
              <h3>Cost by Model</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={3}>
                    {pieData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length] ?? '#5A90F8'} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [`$${(v as number).toFixed(6)}`, 'Cost']}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <h3>Calls by Model</h3>
              <table style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 0', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>Model</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>Calls</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.byModel).map(([model, v]) => (
                      <tr key={model} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 0', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{model}</td>
                      <td style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-secondary)' }}>{v.calls}</td>
                        <td style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-secondary)' }}>${v.cost.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: accentColor || 'var(--accent)' }}>{icon}<span className="stat-label">{label}</span></div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
