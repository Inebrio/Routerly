import { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  getExperimentMetrics, getProjects,
  type ExperimentMetrics, type ExperimentVariantMetrics, type Project,
} from '../../api';
import { SearchableSelect } from '../../components/SearchableSelect';
import { useExperiment } from './ExperimentLayout';

/** Windows offered on top of the whole history. Days back from now, ISO-encoded on the request. */
const RANGES = [
  { value: '', label: 'All time', days: 0 },
  { value: '1', label: 'Last 24 hours', days: 1 },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
] as const;

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

export function ExperimentMetricsTab() {
  const { experiment } = useExperiment();

  const [range, setRange] = useState<string>('');
  const [metrics, setMetrics] = useState<ExperimentMetrics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const experimentId = experiment?.id;

  const load = useCallback(() => {
    if (!experimentId) return;
    setLoading(true);
    const days = Number(range);
    const window = days > 0 ? { from: new Date(Date.now() - days * 86400000).toISOString() } : undefined;
    getExperimentMetrics(experimentId, window)
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
  const bestCost = bestOf(rows, r => (r.calls > 0 ? r.avgCostPerCall : undefined), true);
  const bestLatency = bestOf(rows, r => (r.calls > 0 ? r.avgLatencyMs : undefined), true);
  const bestScore = bestOf(rows, r => r.avgScore, false);

  return (
    <>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="toolbar">
        <span className="toolbar-title">
          {metrics ? `${metrics.totalCalls} call${metrics.totalCalls !== 1 ? 's' : ''} measured` : 'Loading...'}
        </span>
        <div style={{ width: 200 }}>
          <SearchableSelect
            ariaLabel="Time range"
            value={range}
            onChange={setRange}
            options={RANGES.map(r => ({ value: r.value, label: r.label }))}
          />
        </div>
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
          <p className="section-desc" style={{ marginTop: 0 }}>
            {metrics && !metrics.ready
              ? `Not conclusive yet: every variant needs at least ${metrics.minSamplesPerVariant} calls in this window. `
              : ''}
            The better figure of each pair is highlighted: cheaper per call, faster, higher judge score.
          </p>

          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th style={{ textAlign: 'right' }}>Calls</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                  <th style={{ textAlign: 'right' }}>Errors</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Cost / call</th>
                  <th style={{ textAlign: 'right' }}>Avg latency</th>
                  <th style={{ textAlign: 'right' }}>p95</th>
                  <th style={{ textAlign: 'right' }}>Judge score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.variantId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {r.name ?? projectName(r.projectId)}
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
                    <td style={{ textAlign: 'right' }}>{fmtCost(r.cost)}</td>
                    <td style={{ textAlign: 'right', fontWeight: bestCost === r.variantId ? 600 : 400, color: bestCost === r.variantId ? 'var(--primary)' : undefined }}>
                      {fmtCost(r.avgCostPerCall)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: bestLatency === r.variantId ? 600 : 400, color: bestLatency === r.variantId ? 'var(--primary)' : undefined }}>
                      {fmtMs(r.avgLatencyMs)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtMs(r.p95LatencyMs)}</td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

    </>
  );
}
