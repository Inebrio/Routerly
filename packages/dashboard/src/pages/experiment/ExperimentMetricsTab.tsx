import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import {
  getExperimentMetrics, getRouters,
  type ExperimentMetrics, type ExperimentVariantMetrics, type Router,
} from '../../api';
import { DateRangePicker, PRESETS, type DateRange } from '../../components/DateRangePicker';
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
  const { t } = useTranslation();
  const { experiment } = useExperiment();

  // The same picker Overview and Usage carry, so a window means the same thing
  // everywhere; an experiment defaults to its whole history.
  const [range, setRange] = useState<DateRange>(() => PRESETS.find(p => p.label === 'All time')!.range());
  const [metrics, setMetrics] = useState<ExperimentMetrics | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
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
      .catch(e => setErr(e instanceof Error ? e.message : t('experiments.metrics.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, [experimentId, range]);

  useEffect(load, [load]);

  // The table names the router behind each variant: metrics carry the id only.
  useEffect(() => { getRouters().then(setRouters).catch(() => {}); }, []);

  if (!experiment) return null;

  const rows = metrics?.variants ?? [];
  const measured = rows.reduce((s, r) => s + r.calls, 0);
  const routerName = (id: string) => routers.find(p => p.id === id)?.name ?? id.slice(0, 8);
  const label = (r: ExperimentVariantMetrics) => r.name ?? routerName(r.routerId);
  const bestCost = bestOf(rows, r => (r.calls > 0 ? r.avgCostPerCall : undefined), true);
  const bestLatency = bestOf(rows, r => (r.calls > 0 ? r.avgLatencyMs : undefined), true);
  const bestScore = bestOf(rows, r => r.avgScore, false);
  const rowOf = (variantId: string | null) => rows.find(r => r.variantId === variantId);

  const cheapest = rowOf(bestCost);
  const fastest = rowOf(bestLatency);
  const topScore = rowOf(bestScore);

  return (
    <>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="toolbar">
        <span className="toolbar-title">
          {metrics ? t('experiments.metrics.callsMeasured', { count: metrics.totalCalls }) : t('experiments.metrics.loading')}
        </span>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={40} />
          <p>{t('experiments.metrics.empty')}</p>
        </div>
      ) : (
        <>
          <p className="section-desc" style={{ marginTop: 0 }}>
            {metrics && !metrics.ready
              ? t('experiments.metrics.notConclusive', { minSamples: metrics.minSamplesPerVariant })
              : ''}
            {t('experiments.metrics.explanation')}
          </p>

          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 1020 }}>
              <thead>
                <tr>
                  <th>{t('experiments.metrics.columns.variant')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.calls')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.share')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.errors')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.tokens')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.cost')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.costPerCall')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.avgLatency')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.p95')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.ttft')}</th>
                  <th style={{ textAlign: 'right' }}>{t('experiments.metrics.columns.judgeScore')}</th>
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
                            <span className="badge badge-warning" title={t('experiments.metrics.lowSampleTitle', { minSamples: metrics?.minSamplesPerVariant })}>
                              {t('experiments.metrics.lowSample')}
                            </span>
                          )}
                        </div>
                        {r.name && (
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>{routerName(r.routerId)}</div>
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
                            title={t('experiments.metrics.judgedCallsTitle', { count: r.judgedCalls })}
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
