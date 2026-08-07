// RA-16 task 4: trivial change to exercise the single-page selector rule.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Coins, DollarSign, XCircle, Boxes, FolderOpen, Terminal, TrendingUp } from 'lucide-react';
import { CLIENT_REGISTRY } from '@routerly/shared';
import { getUsage, getModels, getRouters, type UsageStats } from '../api.js';
import { useClientsEnabled } from './ConnectPage.js';
import { ChartTooltip, axisProps, seriesColor, useChartTheme } from '../components/charts.js';
import { DateRangePicker, PRESETS, RECENT_PRESETS, parseStoredRange, type DateRange } from '../components/DateRangePicker.js';
import { CostCard, SavingsCard, StatCard, TokensCard, compactCost, savingsSeriesData, type SavingsMetric } from '../components/savings.js';
import { useFilterState } from '../hooks/useFilterState.js';
import { formatCost } from '../utils/traceUtils.js';

export function OverviewPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  // Same picker the Usage page carries, so a window means the same thing on both (T203),
  // and remembered the same way, so a reload keeps the window the user picked.
  const [dateRange, setDateRange] = useFilterState<DateRange>({
    key: 'overview-filters-dateRange',
    defaultValue: PRESETS.find(p => p.label === 'This month')!.range(),
    deserialize: parseStoredRange,
  });

  // A relative preset stored yesterday still says "This month" but holds
  // yesterday's dates: re-apply it so the label and the window agree again.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (RECENT_PRESETS.some(p => p.label === dateRange.label)) return;
    if (!dateRange.to || dateRange.to.slice(0, 10) >= today) return;
    const preset = PRESETS.find(p => p.label === dateRange.label);
    if (preset) setDateRange(preset.range());
  }, []);

  const [modelCount, setModelCount] = useState(0);
  const [routerCount, setRouterCount] = useState(0);
  const [savingsMetric, setSavingsMetric] = useState<SavingsMetric>('cost');
  const chartTheme = useChartTheme();

  useEffect(() => {
    // `series` carries the savings bucketed over time for the chart (T81),
    // `savings` the whole-window totals per baseline the saving cards read (T102).
    let from = dateRange.from || undefined;
    let to = dateRange.to || undefined;
    // A stored minute/hour window is only meaningful relative to now.
    const recentPreset = RECENT_PRESETS.find(p => p.label === dateRange.label);
    if (recentPreset) {
      const fresh = recentPreset.range();
      from = fresh.from;
      to = fresh.to;
    }
    const period = from || to ? 'custom' : 'all';
    getUsage(period, undefined, from, to, undefined, undefined, { series: true, savings: true })
      .then(setStats).catch(() => setStatsError(true));
  }, [dateRange]);

  useEffect(() => {
    getModels().then(m => setModelCount(m.length)).catch(console.error);
    getRouters().then(p => setRouterCount(p.length)).catch(console.error);
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

  const savingsData = useMemo(() => savingsSeriesData(stats?.series), [stats]);

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
    if (statsError) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{t('overview.noPermission')}</div>;
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  return (
    <>
      <div className="page-header">
        <h1>{t('overview.title')}</h1>
        <p>{t('overview.subtitle')}</p>
      </div>
      <div className="page-body">

        <ConnectCard />

        {/* Period selector */}
        <div style={{ marginBottom: 24, display: 'inline-flex' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>

        {/* Stats grid */}
        <div className="stats-grid">
          {/* What routing saved is what the cost would otherwise have been, so it
              rides on the cost itself instead of a card of its own (T201). */}
          <CostCard icon={<DollarSign size={18} />} accentColor="#3D75F5"
            totalCost={stats.summary.totalCost}
            {...(stats.savings ? { savings: stats.savings } : {})}
            to="/dashboard/usage" />
          <TokensCard icon={<Coins size={18} />} accentColor="#8B5CF6"
            inputTokens={totalIn} outputTokens={totalOut} cachedTokens={totalCached}
            {...(stats.savings ? { savings: stats.savings } : {})}
            to="/dashboard/usage" />
          <StatCard icon={<Activity size={18} />} label={t('overview.stats.totalCalls')} accentColor="#5A90F8"
            value={stats.summary.totalCalls}
            sub={t('overview.stats.callsBreakdown', { routing: stats.summary.routingCalls, completion: stats.summary.completionCalls })}
            to="/dashboard/usage" />
          <StatCard icon={<TrendingUp size={18} />} label={t('overview.stats.successRate')} accentColor="#10B981"
            value={stats.summary.totalCalls > 0
              ? `${((stats.summary.successCalls / stats.summary.totalCalls) * 100).toFixed(1)}%`
              : '—'}
            sub={t('overview.stats.ofAllRequests')} to="/dashboard/usage" />
          <StatCard icon={<XCircle size={18} />} label={t('overview.stats.errors')} accentColor="#EF4444" valueColor="#EF4444"
            value={stats.summary.errorCalls} sub={t('overview.stats.failedRequests')} to="/dashboard/usage" />
          <StatCard icon={<Boxes size={18} />} label={t('overview.stats.models')} accentColor="#8B5CF6"
            value={modelCount} sub={t('overview.stats.registered')} to="/dashboard/models" />
          <StatCard icon={<FolderOpen size={18} />} label={t('overview.stats.routers')} accentColor="#A78BFA"
            value={routerCount} sub={t('overview.stats.active')} to="/dashboard/routers" />
        </div>

        {/* What routing saved, over time (T81) */}
        {savingsData.length > 0 && (
          <SavingsCard
            key={dateRange.label}
            data={savingsData}
            baselineIds={stats.series?.baselineModelIds ?? []}
            {...(stats.savings ? { savings: stats.savings } : {})}
            metric={savingsMetric}
            onMetric={setSavingsMetric}
            resetKey={dateRange.label}
          />
        )}

        {/* Cost by model (bar) + Calls by model (table) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Horizontal bar chart — top models by cost */}
          <div className="chart-card" style={{ marginBottom: 0 }}>
            <h3>{t('overview.costByModel')}</h3>
            {barData.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', paddingTop: 8 }}>{t('overview.noCostRecorded')}</p>
            ) : (
              <ResponsiveContainer key={dateRange.label} width="100%" height={Math.max(barData.length * 36, 120)}>
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
            <h3>{t('overview.callsByModel')}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('overview.columns.model')}</th>
                    <th style={{ textAlign: 'right' }}>{t('overview.columns.calls')}</th>
                    <th style={{ textAlign: 'right' }}>{t('overview.columns.errors')}</th>
                    <th style={{ textAlign: 'right' }}>{t('overview.columns.cost')}</th>
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
  const { t } = useTranslation();
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
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 2 }}>{t('overview.connectCard.title')}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {t('overview.connectCard.desc', { count: CLIENT_REGISTRY.length - 3 })}
        </div>
      </div>
      <ArrowRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </Link>
  );
}
