import { useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, DollarSign, Gauge, Star, XCircle } from 'lucide-react';
import {
  getExperimentMetrics, getProjects,
  type ExperimentMetrics, type ExperimentVariantMetrics, type Project,
} from '../../api';
import { DateRangePicker, PRESETS, type DateRange } from '../../components/DateRangePicker';
import { StatCard } from '../../components/savings';
import { useExperiment } from './ExperimentLayout';

const fmtCost = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(5) : n.toFixed(2)}`;
const fmtMs = (n?: number) => (n === undefined ? '—' : `${Math.round(n)} ms`);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Lower is better for cost, latency and errors; higher is better for the judge score. */
function bestOf(rows: ExperimentVariantMetrics[], pick: (r: ExperimentVariantMetrics) => number | undefined, lowerIsBetter: boolean): string | null {
  const scored = rows.filter(r => pick(r) !== undefined);
  if (scored.length < 2) return null;
  const winner = scored.reduce((a, b) => (lowerIsBetter ? (pick(a)! <= pick(b)! ? a : b) : (pick(a)! >= pick(b)! ? a : b)));
  // A tie has no winner to highlight.
  if (scored.filter(r => pick(r) === pick(winner)).length > 1) return null;
  return winner.variantId;
}

/**
 * How far a row sits from the best value of its column. The gap is what an A/B
 * test is read for, and it costs nothing the response does not already carry.
 */
function gap(value: number | undefined, best: number | undefined): string | null {
  if (value === undefined || best === undefined || best === 0 || value === best) return null;
  const pct = Math.round(((value - best) / best) * 100);
  return pct === 0 ? null : `${pct > 0 ? '+' : ''}${pct}%`;
}

export function ExperimentMetricsTab() {
  const { experiment } = useExperiment();

  // The same picker Overview and Usage carry, so a window means the same thing
  // everywhere; an experiment defaults to its whole history.
  const [range, setRange] = useState<DateRange>(() => PRESETS.find(p => p.label === 'All time')!.range());
  const [metrics, setMetrics] = useState<ExperimentMetrics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const experimentId = experiment?.id;

  const load = useCallback(() => {
    if (!experimentId) return;
    setLoading(true);
    getExperimentMetrics(experimentId, {
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
    })
      .then(setMetrics)
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load metrics'))
      .finally(() => setLoading(false));
  }, [experimentId, range]);

  useEffect(load, [load]);

  // The table names the project behind each variant: metrics carry the id only.
  useEffect(() => { getProjects().then(setProjects).catch(() => {}); }, []);

  if (!experiment) return null;

  const rows = metrics?.variants ?? [];
  const measured = rows.reduce((s, r) => s + r.calls, 0);
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id.slice(0, 8);
  const label = (r: ExperimentVariantMetrics) => r.name ?? projectName(r.projectId);
  const bestCost = bestOf(rows, r => (r.calls > 0 ? r.avgCostPerCall : undefined), true);
  const bestLatency = bestOf(rows, r => (r.calls > 0 ? r.avgLatencyMs : undefined), true);
  const bestScore = bestOf(rows, r => r.avgScore, false);
  const rowOf = (variantId: string | null) => rows.find(r => r.variantId === variantId);

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalErrors = rows.reduce((s, r) => s + r.errors, 0);
  const judgedCalls = rows.reduce((s, r) => s + r.judgedCalls, 0);

  const cheapest = rowOf(bestCost);
  const fastest = rowOf(bestLatency);
  const topScore = rowOf(bestScore);
  const worstCost = cheapest ? rows.reduce((a, b) => (a.avgCostPerCall >= b.avgCostPerCall ? a : b)) : undefined;
  const slowest = fastest ? rows.filter(r => r.avgLatencyMs !== undefined).reduce((a, b) => (a.avgLatencyMs! >= b.avgLatencyMs! ? a : b)) : undefined;

  return (
    <>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="toolbar">
        <span className="toolbar-title">
          {metrics ? `${metrics.totalCalls} call${metrics.totalCalls !== 1 ? 's' : ''} measured` : 'Loading...'}
        </span>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={40} />
          <p>No calls in this window yet. Point a client at the experiment token to start the comparison.</p>
        </div>
      ) : (
        <>
          <div className="stats-grid">
            <StatCard icon={<Activity size={18} />} label="Calls" accentColor="#5A90F8"
              value={measured} sub={`across ${rows.length} variant${rows.length !== 1 ? 's' : ''}`} />
            <StatCard icon={<DollarSign size={18} />} label="Cost" accentColor="#3D75F5"
              value={fmtCost(totalCost)} sub="USD in this window" />
            <StatCard icon={<XCircle size={18} />} label="Errors" accentColor="#EF4444"
              {...(totalErrors > 0 ? { valueColor: '#EF4444' } : {})}
              value={totalErrors} sub={measured > 0 ? `${fmtPct(totalErrors / measured)} of the calls` : 'no calls yet'} />
            {cheapest && worstCost && (
              <StatCard icon={<DollarSign size={18} />} label="Cheapest per call" accentColor="#10B981"
                value={label(cheapest)}
                sub={`${fmtCost(cheapest.avgCostPerCall)} vs ${fmtCost(worstCost.avgCostPerCall)}`}
                {...(gap(worstCost.avgCostPerCall, cheapest.avgCostPerCall)
                  ? { sub2: `${gap(worstCost.avgCostPerCall, cheapest.avgCostPerCall)} on the most expensive arm` }
                  : {})} />
            )}
            {fastest && slowest && (
              <StatCard icon={<Gauge size={18} />} label="Fastest" accentColor="#8B5CF6"
                value={label(fastest)}
                sub={`${fmtMs(fastest.avgLatencyMs)} vs ${fmtMs(slowest.avgLatencyMs)} on average`}
                {...(gap(slowest.avgLatencyMs, fastest.avgLatencyMs)
                  ? { sub2: `${gap(slowest.avgLatencyMs, fastest.avgLatencyMs)} on the slowest arm` }
                  : {})} />
            )}
            {topScore && (
              <StatCard icon={<Star size={18} />} label="Best judge score" accentColor="#F59E0B"
                value={label(topScore)}
                sub={`${topScore.avgScore!.toFixed(1)} / 10 over ${judgedCalls} judged call${judgedCalls !== 1 ? 's' : ''}`} />
            )}
          </div>

          <p className="section-desc" style={{ marginTop: 0 }}>
            {metrics && !metrics.ready
              ? `Not conclusive yet: every variant needs at least ${metrics.minSamplesPerVariant} calls in this window. `
              : ''}
            The better figure of each pair is highlighted: cheaper per call, faster, higher judge score. The
            percentage under a value is its distance from the best arm.
          </p>

          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 1020 }}>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th style={{ textAlign: 'right' }}>Calls</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                  <th style={{ textAlign: 'right' }}>Errors</th>
                  <th style={{ textAlign: 'right' }}>Tokens in / out</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Cost / call</th>
                  <th style={{ textAlign: 'right' }}>Avg latency</th>
                  <th style={{ textAlign: 'right' }}>p95</th>
                  <th style={{ textAlign: 'right' }}>TTFT</th>
                  <th style={{ textAlign: 'right' }}>Judge score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const costGap = r.variantId === bestCost ? null : gap(r.avgCostPerCall, cheapest?.avgCostPerCall);
                  const latencyGap = r.variantId === bestLatency ? null : gap(r.avgLatencyMs, fastest?.avgLatencyMs);
                  const scoreGap = r.variantId === bestScore ? null : gap(r.avgScore, topScore?.avgScore);
                  return (
                    <tr key={r.variantId}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {label(r)}
                          {!r.enoughSamples && (
                            <span className="badge badge-warning" title={`Under ${metrics?.minSamplesPerVariant} calls in this window`}>
                              Low sample
                            </span>
                          )}
                        </div>
                        {r.name && (
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>{projectName(r.projectId)}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.calls}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {measured > 0 ? fmtPct(r.calls / measured) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.errors > 0 ? `${r.errors} (${fmtPct(r.errorRate)})` : '0'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtCost(r.cost)}</td>
                      <td style={{ textAlign: 'right', fontWeight: bestCost === r.variantId ? 600 : 400, color: bestCost === r.variantId ? 'var(--primary)' : undefined }}>
                        {fmtCost(r.avgCostPerCall)}
                        {costGap && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{costGap}</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: bestLatency === r.variantId ? 600 : 400, color: bestLatency === r.variantId ? 'var(--primary)' : undefined }}>
                        {fmtMs(r.avgLatencyMs)}
                        {latencyGap && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{latencyGap}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtMs(r.p95LatencyMs)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{fmtMs(r.avgTtftMs)}</td>
                      <td style={{ textAlign: 'right', fontWeight: bestScore === r.variantId ? 600 : 400, color: bestScore === r.variantId ? 'var(--primary)' : undefined }}>
                        {r.avgScore !== undefined ? `${r.avgScore.toFixed(1)} / 10` : '—'}
                        {r.judgedCalls > 0 && (
                          <span
                            style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 6 }}
                            title={`${r.judgedCalls} answer${r.judgedCalls !== 1 ? 's' : ''} scored by the judge`}
                          >
                            ({r.judgedCalls})
                          </span>
                        )}
                        {scoreGap && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{scoreGap}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

    </>
  );
}
