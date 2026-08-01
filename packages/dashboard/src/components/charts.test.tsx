import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// ponytail: recharts renders nothing measurable in jsdom — stub it and expose the
// props the chart system sets, so the assertions are about our config, not theirs.
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: ({ dataKey, stroke, strokeDasharray, fill }: Record<string, unknown>) => (
    <div data-testid="area" data-key={String(dataKey)} data-stroke={String(stroke)}
      data-dash={strokeDasharray == null ? '' : String(strokeDasharray)} data-fill={String(fill)} />
  ),
  CartesianGrid: ({ stroke }: { stroke?: string }) => <div data-testid="grid" data-stroke={stroke} />,
  XAxis: ({ dataKey, tick }: Record<string, unknown>) => (
    <div data-testid="x-axis" data-key={String(dataKey)} data-tick={String((tick as { fill?: string })?.fill)} />
  ),
  YAxis: ({ tickFormatter, tick }: Record<string, unknown>) => (
    <div data-testid="y-axis" data-tick={String((tick as { fill?: string })?.fill)}>
      {(tickFormatter as ((v: number) => string) | undefined)?.(1.5)}
    </div>
  ),
  Tooltip: ({ content }: { content?: React.ReactElement }) => <div data-testid="tooltip">{content}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseTheme = vi.fn(() => ({ theme: 'light', setTheme: vi.fn() }));
vi.mock('../ThemeContext.js', () => ({
  get useTheme() { return mockUseTheme; },
}));

import { ChartTooltip, TimeSeriesChart, CHART_COLORS, seriesColor, axisProps, useChartTheme, useIsDark } from './charts';

/** Installs a matchMedia whose `matches` answers the light-scheme query. */
function stubMatchMedia(prefersLight: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches: prefersLight,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => { listeners.push(fn); },
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue(mql), configurable: true, writable: true,
  });
  return { emit: (matches: boolean) => listeners.forEach(fn => fn({ matches } as MediaQueryListEvent)) };
}

beforeEach(() => {
  mockUseTheme.mockReturnValue({ theme: 'light', setTheme: vi.fn() });
  stubMatchMedia(true);
});

afterEach(() => vi.clearAllMocks());

// ── Palette ────────────────────────────────────────────────────────────────

describe('seriesColor', () => {
  it('returns the palette entry at the given index', () => {
    expect(seriesColor(0)).toBe(CHART_COLORS[0]);
    expect(seriesColor(3)).toBe(CHART_COLORS[3]);
  });

  it('wraps around instead of returning undefined', () => {
    expect(seriesColor(CHART_COLORS.length)).toBe(CHART_COLORS[0]);
    expect(seriesColor(CHART_COLORS.length + 2)).toBe(CHART_COLORS[2]);
  });
});

// ── Theme resolution ───────────────────────────────────────────────────────

function ThemeProbe() {
  const theme = useChartTheme();
  const dark = useIsDark();
  return <div data-testid="probe" data-tick={theme.tick} data-grid={theme.grid} data-dark={String(dark)} />;
}

describe('useChartTheme', () => {
  it('uses the light palette when the theme is light', () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('probe').dataset.dark).toBe('false');
    expect(screen.getByTestId('probe').dataset.tick).toBe('#64748b');
  });

  it('uses the dark palette when the theme is dark', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() });
    render(<ThemeProbe />);
    expect(screen.getByTestId('probe').dataset.dark).toBe('true');
    expect(screen.getByTestId('probe').dataset.tick).toBe('#94a3b8');
  });

  it('follows the OS while the theme is auto', () => {
    stubMatchMedia(false); // OS does not prefer light → dark
    mockUseTheme.mockReturnValue({ theme: 'auto', setTheme: vi.fn() });
    render(<ThemeProbe />);
    expect(screen.getByTestId('probe').dataset.dark).toBe('true');
  });

  it('repaints when the OS switches scheme under auto', () => {
    const media = stubMatchMedia(false);
    mockUseTheme.mockReturnValue({ theme: 'auto', setTheme: vi.fn() });
    render(<ThemeProbe />);
    expect(screen.getByTestId('probe').dataset.dark).toBe('true');
    act(() => media.emit(true)); // OS switched to light
    expect(screen.getByTestId('probe').dataset.dark).toBe('false');
  });
});

describe('axisProps', () => {
  it('carries the tick colour and drops the axis and tick lines', () => {
    const props = axisProps({ tick: '#111', grid: '#222', cursor: '#333' });
    expect(props.tick.fill).toBe('#111');
    expect(props.axisLine).toBe(false);
    expect(props.tickLine).toBe(false);
  });
});

// ── Tooltip ────────────────────────────────────────────────────────────────

describe('ChartTooltip', () => {
  const entry = { name: 'Cost', value: 0.5, color: '#3d75f5', dataKey: 'cost' };

  it('renders nothing while inactive', () => {
    const { container } = render(<ChartTooltip active={false} payload={[entry]} formatValue={String} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing with an empty payload', () => {
    const { container } = render(<ChartTooltip active payload={[]} formatValue={String} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders one row per series, with the label as header', () => {
    render(
      <ChartTooltip active label="07-14" payload={[entry, { name: 'Baseline', value: 2, color: '#10b981', dataKey: 'b' }]}
        formatValue={v => `$${v.toFixed(2)}`} />,
    );
    expect(screen.getByText('07-14')).toBeTruthy();
    expect(screen.getByText('Cost')).toBeTruthy();
    expect(screen.getByText('$0.50')).toBeTruthy();
    expect(screen.getByText('Baseline')).toBeTruthy();
    expect(screen.getByText('$2.00')).toBeTruthy();
  });

  it('lets the caller rewrite the row name from the point payload', () => {
    render(
      <ChartTooltip active payload={[{ ...entry, payload: { fullName: 'openai/gpt-4o' } }]}
        formatValue={v => String(v)} formatName={e => String(e.payload?.fullName)} />,
    );
    expect(screen.getByText('openai/gpt-4o')).toBeTruthy();
  });

  it('drops the header when the formatter blanks it', () => {
    render(<ChartTooltip active label="gpt-4o" payload={[entry]} formatValue={String} formatLabel={() => ''} />);
    expect(screen.queryByText('gpt-4o')).toBeNull();
  });

  it('expands the header through the formatter', () => {
    render(<ChartTooltip active label="07-14" payload={[entry]} formatValue={String} formatLabel={l => `July ${l.slice(3)}`} />);
    expect(screen.getByText('July 14')).toBeTruthy();
  });

  it('treats a missing value as zero rather than NaN', () => {
    render(<ChartTooltip active payload={[{ name: 'Cost', color: '#000' }]} formatValue={v => `${v} usd`} />);
    expect(screen.getByText('0 usd')).toBeTruthy();
  });
});

// ── Time series ────────────────────────────────────────────────────────────

describe('TimeSeriesChart', () => {
  const data = [{ date: '07-14', cost: 1 }, { date: '07-15', cost: 2 }];

  it('draws one area per series, keyed on the x field', () => {
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={v => `$${v}`}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(screen.getByTestId('x-axis').dataset.key).toBe('date');
    const areas = screen.getAllByTestId('area');
    expect(areas).toHaveLength(1);
    expect(areas[0]!.dataset.key).toBe('cost');
    expect(areas[0]!.dataset.stroke).toBe('#3d75f5');
  });

  it('hides the legend for a single series and shows it for more', () => {
    const { rerender, container } = render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(container.querySelector('.chart-legend')).toBeNull();

    rerender(
      <TimeSeriesChart data={data} xKey="date" formatValue={String} series={[
        { key: 'cost', label: 'Cost', color: '#3d75f5' },
        { key: 'baseline', label: 'Baseline', color: '#10b981', dashed: true },
      ]} />,
    );
    expect(container.querySelector('.chart-legend')).not.toBeNull();
    expect(screen.getByText('Baseline')).toBeTruthy();
  });

  it('dashes the counterfactual series', () => {
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String} series={[
        { key: 'cost', label: 'Cost', color: '#3d75f5' },
        { key: 'baseline', label: 'Baseline', color: '#10b981', dashed: true },
      ]} />,
    );
    const areas = screen.getAllByTestId('area');
    expect(areas[0]!.dataset.dash).toBe('');
    expect(areas[1]!.dataset.dash).toBe('4 3');
  });

  it('gives each series its own gradient id so two charts cannot share a fill', () => {
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    const fill = screen.getAllByTestId('area')[0]!.dataset.fill!;
    expect(fill).toMatch(/^url\(#.+-cost\)$/);
    expect(fill).not.toContain(':');
  });

  it('formats the y axis with formatAxis when given, formatValue otherwise', () => {
    const { rerender } = render(
      <TimeSeriesChart data={data} xKey="date" formatValue={v => `$${v}`}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(screen.getByTestId('y-axis').textContent).toBe('$1.5');

    rerender(
      <TimeSeriesChart data={data} xKey="date" formatValue={v => `$${v}`} formatAxis={v => `${v}k`}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(screen.getByTestId('y-axis').textContent).toBe('1.5k');
  });

  it('paints axes and grid with the active theme', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() });
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(screen.getByTestId('x-axis').dataset.tick).toBe('#94a3b8');
    expect(screen.getByTestId('grid').dataset.stroke).toBe('rgba(255,255,255,0.07)');
  });

  it('hands the tooltip to recharts as content, not as inline styles', () => {
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={v => `$${v}`}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(screen.getByTestId('tooltip')).toBeTruthy();
  });

  it('defaults the x key to "label"', () => {
    render(
      <TimeSeriesChart data={[{ label: 'a', cost: 1 }]} formatValue={String}
        series={[{ key: 'cost', label: 'Cost', color: '#3d75f5' }]} />,
    );
    expect(screen.getByTestId('x-axis').dataset.key).toBe('label');
  });

  it('keeps a hidden series in the legend and out of the plot', () => {
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String} onToggleSeries={vi.fn()} series={[
        { key: 'cost', label: 'Cost', color: '#3d75f5' },
        { key: 'baseline', label: 'Baseline', color: '#10b981', dashed: true, hidden: true },
      ]} />,
    );
    const areas = screen.getAllByTestId('area');
    expect(areas.map(a => a.dataset.key)).toEqual(['cost']);
    const off = screen.getByRole('button', { name: 'Baseline' });
    expect(off.className).toContain('is-off');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.getAttribute('title')).toBe('Show Baseline');
  });

  it('reports the clicked series key to onToggleSeries', () => {
    const onToggleSeries = vi.fn();
    render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String} onToggleSeries={onToggleSeries} series={[
        { key: 'cost', label: 'Cost', color: '#3d75f5' },
        { key: 'baseline', label: 'Baseline', color: '#10b981', dashed: true },
      ]} />,
    );
    const on = screen.getByRole('button', { name: 'Baseline' });
    expect(on.getAttribute('title')).toBe('Hide Baseline');
    on.click();
    expect(onToggleSeries).toHaveBeenCalledWith('baseline');
  });

  it('leaves the legend unclickable when nothing can be toggled', () => {
    const { container } = render(
      <TimeSeriesChart data={data} xKey="date" formatValue={String} series={[
        { key: 'cost', label: 'Cost', color: '#3d75f5' },
        { key: 'baseline', label: 'Baseline', color: '#10b981', dashed: true },
      ]} />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
