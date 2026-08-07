import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SavingsBaseline, SavingsSummary, UsageSeries } from '@routerly/shared';
import { TimeSeriesChart, seriesColor, type ChartSeries } from './charts.js';
import { formatCost, formatTokens } from '../utils/traceUtils.js';

/** Model id without its provider prefix: what fits in a legend entry. */
export const shortModel = (id: string): string => id.split('/').pop() ?? id;

/** What the savings chart is showing. */
export type SavingsMetric = 'cost' | 'tokens';

const savingsMetricLabel = (t: TFunction, m: SavingsMetric): string =>
  m === 'cost' ? t('common.savings.metricCost') : t('common.savings.metricTokens');

/** Colours the token split keeps in step with the Tokens series of the chart. */
const TOKEN_IN_COLOR = seriesColor(5);
const TOKEN_OUT_COLOR = seriesColor(1);

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

/** Token counts short enough for a card or an axis tick: 940, 1.2k, 3.4M, 2.1B. */
export const compactTokens = (v: number): string =>
  v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)}B`
    : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000 ? `${(v / 1000).toFixed(1)}k`
        : String(Math.round(v));

/**
 * One chart point per bucket. Every paid baseline gets its own `b<i>` key rather
 * than its model id: recharts reads a dataKey containing a dot as a path, and
 * model ids are full of dots.
 */
export function savingsSeriesData(series?: UsageSeries): Array<Record<string, string | number>> {
  if (!series) return [];
  return series.points.map(p => ({
    label: series.bucket === 'hour' ? `${p.bucket.slice(11)}:00` : p.bucket.slice(5),
    cost: p.cost,
    ...Object.fromEntries(series.baselineModelIds.map((id, i) => [`b${i}`, p.baselineCosts[id] ?? 0])),
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
  }));
}

/**
 * The baselines routing is measured against, cheapest saving first: the single-model
 * policies that would have cost something. Empty when nothing paid in the window.
 */
export const paidBaselines = (savings?: SavingsSummary): SavingsBaseline[] =>
  [...(savings?.baselines ?? []).filter(b => b.cost > 0)].sort((a, b) => a.costDelta - b.costDelta);

/**
 * The savings layer over time (T81): what the routed traffic cost and moved,
 * against what the same calls would have cost on every single model the
 * routers allow.
 *
 * The counterfactual is drawn dashed because it never happened. Tokens have no
 * counterfactual at all: the same conversation is assumed to produce the same
 * tokens everywhere, so only the price of those tokens changes.
 */
export function SavingsCard({ data, baselineIds, savings, metric, onMetric, resetKey }: {
  data: Array<Record<string, string | number>>;
  /** Paid models the chart can price against, cheapest first. */
  baselineIds: string[];
  savings?: SavingsSummary;
  metric: SavingsMetric;
  onMetric: (m: SavingsMetric) => void;
  /** Changes with the window, so the chart remounts instead of animating across it. */
  resetKey: string;
}) {
  // Cheapest and costliest are the two ends of the range, so those two start
  // visible; every other paid model waits in the legend, one click away (T100).
  // The default is derived at render, not seeded into state: the card mounts
  // before the first fetch answers, when baselineIds is still empty, and a
  // seeded set would keep that empty default forever and draw every line.
  const { t } = useTranslation();
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const hiddenKeys = hidden ?? new Set(
    baselineIds.flatMap((_, i) => (i === 0 || i === baselineIds.length - 1 ? [] : [`b${i}`])),
  );
  const toggle = (key: string) => setHidden(() => {
    const next = new Set(hiddenKeys);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const series: ChartSeries[] = (metric === 'tokens'
    ? [
      { key: 'inputTokens', label: t('common.savings.input'), color: TOKEN_IN_COLOR },
      { key: 'outputTokens', label: t('common.savings.output'), color: TOKEN_OUT_COLOR },
    ]
    : [
      { key: 'cost', label: t('common.savings.actual'), color: seriesColor(0) },
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

  const formatValue = metric === 'cost' ? formatCost : formatTokens;
  const formatAxis = metric === 'cost' ? compactCost : compactTokens;

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div>
          <h3>{t('common.savings.title')}</h3>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {t('common.savings.clientCalls', { count: savings?.comparedCalls ?? 0 })}
            {baselineIds.length > 0 && (
              <>
                {t('common.savings.comparedAgainst', { count: savings?.comparedCalls ?? 0 })}
                {' '}
                <Link to="/dashboard/models" style={{ color: 'var(--accent)' }}>{t('common.savings.paidModelsInPlay', { count: baselineIds.length })}</Link>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 3, gap: 2 }}>
          {(['cost', 'tokens'] as const).map(m => (
            <button
              key={m}
              className={`theme-btn${metric === m ? ' active' : ''}`}
              style={{ minWidth: 64 }}
              onClick={() => onMetric(m)}
            >
              {savingsMetricLabel(t, m)}
            </button>
          ))}
        </div>
      </div>

      <TimeSeriesChart
        key={`${resetKey}-${metric}`}
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
 * A number split in two, drawn to scale. Segments under a couple of percent are
 * still given a sliver of width, so a lopsided split reads as lopsided rather
 * than as a single colour.
 */
function SplitBar({ segments }: { segments: Array<{ value: number; color: string; label: string }> }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div
      style={{ display: 'flex', gap: 2, height: 6, marginTop: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--border)' }}
      role="presentation"
    >
      {segments.map(s => (
        <div
          key={s.label}
          title={s.label}
          style={{ width: `${total > 0 ? Math.max(1.5, (s.value / total) * 100) : 0}%`, background: s.color }}
        />
      ))}
    </div>
  );
}

/**
 * What the traffic cost, against what it would have cost had every call gone to
 * the costliest single model the routers allow (T201). The bar is the whole
 * counterfactual bill, the coloured part is the bill that was actually paid, so
 * the gap between them is the saving without a second number to read.
 *
 * A saving that is zero or negative gets no bar at all (T202): a full bar or a
 * red number is a measurement artefact of a window too small to compare.
 */
export function CostCard({ totalCost, savings, icon, accentColor, to }: {
  totalCost: number;
  savings?: SavingsSummary;
  icon?: React.ReactNode;
  accentColor?: string;
  to?: string;
}) {
  const { t } = useTranslation();
  const paid = paidBaselines(savings);
  const anchor = paid[paid.length - 1];
  const saved = anchor && anchor.costDelta > 0 ? anchor : undefined;
  const percent = saved ? Math.round((saved.costDelta / saved.cost) * 100) : 0;

  return (
    <StatCard
      {...(icon ? { icon } : {})}
      {...(accentColor ? { accentColor } : {})}
      {...(to ? { to } : {})}
      label={t('common.savings.totalCost')}
      value={`$${totalCost.toFixed(4)}`}
      extra={saved && (
        <SplitBar segments={[
          { value: totalCost, color: accentColor ?? 'var(--accent)', label: t('common.savings.routed', { value: formatCost(totalCost) }) },
          { value: saved.costDelta, color: 'transparent', label: t('common.savings.saved', { value: formatCost(saved.costDelta) }) },
        ]} />
      )}
      sub={t('common.savings.usdThisPeriod')}
      {...(saved ? { sub2: t('common.savings.savedVsAlways', { value: formatCost(saved.costDelta), percent, model: shortModel(saved.modelId) }) } : {})}
    />
  );
}

/**
 * Tokens in and out for the window, split to scale. What the optimizers cut sits
 * on the same card, because it is a token count too and the only reason the one
 * above it is lower than it would have been. The measured figure wins over the
 * estimate: an optimizer knows what it removed, a foreign tokenizer is guessed at.
 */
export function TokensCard({ inputTokens, outputTokens, cachedTokens = 0, savings, icon, accentColor, to }: {
  inputTokens: number;
  outputTokens: number;
  /** Part of the input that was served from the provider cache. */
  cachedTokens?: number;
  savings?: SavingsSummary;
  icon?: React.ReactNode;
  accentColor?: string;
  to?: string;
}) {
  const { t } = useTranslation();
  const optimizerTokens = (savings?.optimizers ?? []).reduce((sum, o) => sum + o.tokensSaved, 0);
  const paid = paidBaselines(savings);
  const anchor = paid[paid.length - 1];

  return (
    <StatCard
      {...(icon ? { icon } : {})}
      {...(accentColor ? { accentColor } : {})}
      {...(to ? { to } : {})}
      label={t('common.savings.tokens')}
      value={compactTokens(inputTokens + outputTokens)}
      extra={(inputTokens + outputTokens) > 0 && (
        <SplitBar segments={[
          { value: inputTokens, color: TOKEN_IN_COLOR, label: t('common.savings.in', { value: formatTokens(inputTokens) }) },
          { value: outputTokens, color: TOKEN_OUT_COLOR, label: t('common.savings.out', { value: formatTokens(outputTokens) }) },
        ]} />
      )}
      sub={cachedTokens > 0
        ? t('common.savings.tokenSubWithCache', { in: compactTokens(inputTokens), out: compactTokens(outputTokens), cached: compactTokens(cachedTokens) })
        : t('common.savings.tokenSub', { in: compactTokens(inputTokens), out: compactTokens(outputTokens) })}
      {...(optimizerTokens > 0
        ? { sub2: t('common.savings.cutByOptimizers', { value: compactTokens(optimizerTokens) }) }
        : anchor && anchor.tokenDelta > 0
          ? { sub2: t('common.savings.fewerThanAlways', { value: compactTokens(anchor.tokenDelta), model: shortModel(anchor.modelId) }) }
          : {})}
    />
  );
}

export function StatCard({ icon, label, value, extra, sub, sub2, accentColor, valueColor, to }: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  /** Sits between the number and its caption: room for a bar that shows the number's shape. */
  extra?: React.ReactNode;
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
      {extra}
      <div className="stat-sub">{sub}</div>
      {sub2 && <div className="stat-sub">{sub2}</div>}
    </>
  );

  return to
    ? <Link to={to} className="stat-card" style={style}>{body}</Link>
    : <div className="stat-card" style={style}>{body}</div>;
}
