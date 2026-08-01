import { useEffect, useId, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTheme } from '../ThemeContext.js';

/**
 * The one chart system the dashboard draws with (T80).
 *
 * Every chart in the app takes its colours, axes, grid and tooltip from here,
 * so a chart added tomorrow looks like the ones added yesterday and reads the
 * same in light and dark. Recharts renders SVG, and `var(--token)` does not
 * resolve inside SVG presentation attributes, which is why the axis colours are
 * resolved in JS from the active theme while the tooltip, being plain HTML,
 * keeps using the CSS tokens directly.
 */

/** Series palette. Ordered so the first colours stay distinguishable on both themes. */
export const CHART_COLORS = [
  '#3d75f5', // accent blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#a78bfa', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#64748b', // slate
] as const;

/** Colour for a series at position `i`, wrapping around the palette. */
export const seriesColor = (i: number): string => CHART_COLORS[i % CHART_COLORS.length]!;

/**
 * `true` when the dashboard is currently painting the dark palette, following
 * the OS while the theme is `auto`. Charts re-render on an OS theme switch
 * because the listener updates state, which the CSS-only tokens get for free.
 */
export function useIsDark(): boolean {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(
    () => !window.matchMedia('(prefers-color-scheme: light)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(!e.matches);
    /* v8 ignore next */
    if (!mql.addEventListener) return;
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return theme === 'dark' || (theme === 'auto' && systemDark);
}

export interface ChartTheme {
  /** Axis tick labels. */
  tick: string;
  /** Horizontal grid lines. */
  grid: string;
  /** The line or band that follows the pointer. */
  cursor: string;
}

const DARK: ChartTheme = { tick: '#94a3b8', grid: 'rgba(255,255,255,0.07)', cursor: 'rgba(148,163,184,0.35)' };
const LIGHT: ChartTheme = { tick: '#64748b', grid: '#e2e8f0', cursor: 'rgba(100,116,139,0.35)' };

export function useChartTheme(): ChartTheme {
  return useIsDark() ? DARK : LIGHT;
}

/** What recharts hands a tooltip for one series at the hovered point. */
export interface ChartTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: string | number;
  /** Renders the value of one row. */
  formatValue: (value: number, entry: ChartTooltipEntry) => string;
  /** Overrides the row label, e.g. to show a full model id instead of its short name. */
  formatName?: (entry: ChartTooltipEntry) => string;
  /** Overrides the header, e.g. to expand a date key into a readable date. */
  formatLabel?: (label: string) => string;
}

/**
 * Tooltip for every chart. Recharts' built-in one is styled through inline
 * props, which is how the old Cost by model tooltip ended up unreadable on one
 * theme or the other; this is plain HTML styled by the same tokens as the rest
 * of the dashboard, so it can only be right on both.
 */
export function ChartTooltip({ active, payload, label, formatValue, formatName, formatLabel }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const header = label == null || label === '' ? '' : formatLabel ? formatLabel(String(label)) : String(label);

  return (
    <div className="chart-tooltip">
      {header && <div className="chart-tooltip-label">{header}</div>}
      {payload.map((entry, i) => (
        <div className="chart-tooltip-row" key={`${String(entry.dataKey ?? i)}`}>
          <span className="chart-tooltip-swatch" style={{ background: entry.color }} />
          <span className="chart-tooltip-name">{formatName ? formatName(entry) : entry.name}</span>
          <span className="chart-tooltip-value">{formatValue(Number(entry.value ?? 0), entry)}</span>
        </div>
      ))}
    </div>
  );
}

export interface ChartSeries {
  /** Key of the value in each data point. */
  key: string;
  label: string;
  color: string;
  /** Dashed and unfilled: for a counterfactual, something that did not happen. */
  dashed?: boolean;
  /** Kept in the legend, left out of the plot. Only meaningful with `onToggleSeries`. */
  hidden?: boolean;
}

export interface TimeSeriesChartProps {
  data: Array<Record<string, string | number>>;
  series: ChartSeries[];
  /** Key of the x label in each data point. */
  xKey?: string;
  height?: number;
  /** Tooltip values. */
  formatValue: (value: number) => string;
  /** Y axis ticks. Defaults to `formatValue`. */
  formatAxis?: (value: number) => string;
  /** Tooltip header. */
  formatLabel?: (label: string) => string;
  /** Makes the legend clickable: called with the key of the entry that was clicked. */
  onToggleSeries?: (key: string) => void;
}

/**
 * Area chart over time, one area per series. Used for anything with a date on
 * the x axis; a chart drawn any other way would have to re-declare axes, grid,
 * cursor and tooltip, which is exactly the drift this module exists to stop.
 */
export function TimeSeriesChart({
  data, series, xKey = 'label', height = 200, formatValue, formatAxis, formatLabel, onToggleSeries,
}: TimeSeriesChartProps) {
  const theme = useChartTheme();
  // Gradient ids are document-global: two charts on one page would otherwise
  // share the first one's fill.
  const uid = useId().replace(/:/g, '');
  // A hidden series keeps its legend entry, dimmed: that entry is how it comes back.
  const plotted = series.filter(s => !s.hidden);

  return (
    <>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map(s => {
            const swatch = (
              <span
                className="chart-legend-swatch"
                style={s.dashed
                  ? { background: 'transparent', border: `1px dashed ${s.color}` }
                  : { background: s.color }}
              />
            );
            return onToggleSeries ? (
              <button
                type="button"
                className={`chart-legend-item chart-legend-toggle${s.hidden ? ' is-off' : ''}`}
                key={s.key}
                onClick={() => onToggleSeries(s.key)}
                aria-pressed={!s.hidden}
                title={s.hidden ? `Show ${s.label}` : `Hide ${s.label}`}
              >
                {swatch}
                {s.label}
              </button>
            ) : (
              <span className="chart-legend-item" key={s.key}>
                {swatch}
                {s.label}
              </span>
            );
          })}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {plotted.map(s => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={s.dashed ? 0.06 : 0.25} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: theme.tick, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis
            tick={{ fill: theme.tick, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
            tickFormatter={v => (formatAxis ?? formatValue)(Number(v))}
          />
          <Tooltip
            cursor={{ stroke: theme.cursor, strokeWidth: 1 }}
            content={<ChartTooltip formatValue={formatValue} {...(formatLabel ? { formatLabel } : {})} />}
          />
          {plotted.map(s => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              {...(s.dashed ? { strokeDasharray: '4 3' } : {})}
              fill={`url(#${uid}-${s.key})`}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

/** Axis props every non-time chart shares, so a bar chart matches a line chart. */
export function axisProps(theme: ChartTheme) {
  return { tick: { fill: theme.tick, fontSize: 11 }, axisLine: false as const, tickLine: false as const };
}
