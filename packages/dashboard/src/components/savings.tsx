import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Scissors, Timer } from 'lucide-react';
import type { SavingsBaseline, SavingsSummary, UsageSeries } from '@routerly/shared';
import { TimeSeriesChart, seriesColor, type ChartSeries } from './charts.js';
import { formatCost, formatDuration, formatTokens } from '../utils/traceUtils.js';

/** Model id without its provider prefix: what fits in a legend entry. */
export const shortModel = (id: string): string => id.split('/').pop() ?? id;

/** What the savings chart is showing. */
export type SavingsMetric = 'cost' | 'tokens' | 'speed';

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

export const compactTokens = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

/**
 * One chart point per bucket, with the derived per-call figures the Speed metric
 * needs. Every paid baseline gets its own `b<i>` key rather than its model id:
 * recharts reads a dataKey containing a dot as a path, and model ids are full
 * of dots.
 */
export function savingsSeriesData(series?: UsageSeries): Array<Record<string, string | number>> {
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
}

/**
 * The baselines routing is measured against, cheapest saving first: the single-model
 * policies that would have cost something. Empty when nothing paid in the window.
 */
export const paidBaselines = (savings?: SavingsSummary): SavingsBaseline[] =>
  [...(savings?.baselines ?? []).filter(b => b.cost > 0)].sort((a, b) => a.costDelta - b.costDelta);

/**
 * The line the Total Cost card carries when routing came out ahead: what the same
 * traffic would have cost on the costliest single model it could have gone to.
 * A saving that is zero or negative says nothing worth a line, so it gets none.
 */
export function costSavedNote(savings?: SavingsSummary): string | undefined {
  const paid = paidBaselines(savings);
  const anchor = paid[paid.length - 1];
  if (!anchor || anchor.costDelta <= 0) return undefined;
  return `${formatCost(anchor.costDelta)} saved vs always ${shortModel(anchor.modelId)}`;
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
export function SavingsCard({ data, baselineIds, baselineModelId, savings, metric, onMetric, resetKey }: {
  data: Array<Record<string, string | number>>;
  /** Paid models the chart can price against, cheapest first. */
  baselineIds: string[];
  /** Costliest baseline: what the Speed counterfactual is estimated from. */
  baselineModelId?: string;
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
                {savings?.comparedCalls === 1 ? ', against sending it to each of the ' : ', against sending them all to each of the '}
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
 * What routing saved in time and tokens, as extra cards in the summary grid (T102).
 * The money saved is not here: it belongs to the number it changes, so it rides on
 * the Total Cost card as a second line (T201).
 *
 * Both cards are anchored on the same baseline: the costliest single model the
 * traffic could have gone to, which is the policy routing replaces. A saving that
 * is zero or negative is not shown at all (T202): a card reading "0" or a red
 * number is a measurement artefact of a window too small to compare, not news.
 *
 * Time comes from each model's own throughput in the window, so a baseline that
 * never answered carries none. Tokens are two things kept apart on purpose: what
 * the optimizers really cut, which is measured, and what a different tokenizer
 * would have counted, which is an estimate.
 */
export function SavingsStats({ savings }: { savings: SavingsSummary }) {
  const paid = paidBaselines(savings);
  const anchor = paid[paid.length - 1];
  if (!anchor) return null;

  const anchorName = shortModel(anchor.modelId);
  const optimizerTokens = savings.optimizers.reduce((sum, o) => sum + o.tokensSaved, 0);
  // The anchor is picked on price, so it need not be one of the models that
  // answered: the time card falls back to the costliest one that did.
  const timed = paid.filter(b => (b.latencyDeltaMs ?? 0) > 0);
  const timeAnchor = timed[timed.length - 1];

  return (
    <>
      {timeAnchor && (
        <StatCard icon={<Timer size={18} />} label="Time saved" accentColor="#F59E0B"
          value={formatDuration(timeAnchor.latencyDeltaMs!)}
          sub={`vs always ${shortModel(timeAnchor.modelId)}`}
        />
      )}
      {optimizerTokens > 0 ? (
        <StatCard icon={<Scissors size={18} />} label="Tokens saved" accentColor="#8B5CF6"
          value={formatTokens(optimizerTokens)}
          sub="cut by optimizers, measured"
          {...(anchor.tokenDelta > 0 ? { sub2: `${formatTokens(anchor.tokenDelta)} vs always ${anchorName}, estimated` } : {})}
        />
      ) : anchor.tokenDelta > 0 ? (
        <StatCard icon={<Scissors size={18} />} label="Tokens saved" accentColor="#8B5CF6"
          value={formatTokens(anchor.tokenDelta)}
          sub={`vs always ${anchorName}, estimated`}
        />
      ) : null}
    </>
  );
}

export function StatCard({ icon, label, value, sub, sub2, accentColor, valueColor, to }: {
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
