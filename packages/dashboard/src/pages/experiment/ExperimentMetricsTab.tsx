import { useCallback, useEffect, useState } from 'react';
import { Trophy, BarChart3 } from 'lucide-react';
import {
  closeExperiment, getExperimentMetrics,
  type ExperimentMetrics, type ExperimentVariantMetrics,
} from '../../api';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAuth } from '../../AuthContext';
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
  const { experiment, setExperiment } = useExperiment();
  const { can } = useAuth();
  const canManage = can('experiments:manage');

  const [range, setRange] = useState<string>('');
  const [metrics, setMetrics] = useState<ExperimentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [winner, setWinner] = useState('');
  const [confirming, setConfirming] = useState(false);

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

  if (!experiment) return null;

  async function handleClose() {
    setConfirming(false);
    setErr('');
    try {
      setExperiment(await closeExperiment(experiment!.id, winner || undefined));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to close the experiment');
    }
  }

  const rows = metrics?.variants ?? [];
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
          {metrics && !metrics.ready && (
            <p className="section-desc" style={{ marginTop: 0 }}>
              Not conclusive yet: every variant needs at least {metrics.minSamplesPerVariant} calls in this window.
            </p>
          )}

          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th style={{ textAlign: 'right' }}>Calls</th>
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
                        {r.name ?? r.variantId}
                        {experiment.winnerVariantId === r.variantId && (
                          <span className="badge badge-success" title="Declared winner"><Trophy size={12} /> Winner</span>
                        )}
                        {!r.enoughSamples && <span className="badge badge-warning">Low sample</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.calls}</td>
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
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 6 }}>({r.judgedCalls})</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canManage && experiment.status === 'running' && (
        <div className="form-section" style={{ marginTop: 32 }}>
          <div className="section-title">Close this experiment</div>
          <p className="section-desc">
            Closing stops variant rotation: the experiment's tokens stop working, so move clients to the winning
            project's own token first. The winner is your call, the numbers only inform it.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 260 }}>
              <SearchableSelect
                ariaLabel="Winning variant"
                placeholder="No winner"
                value={winner}
                onChange={setWinner}
                options={[
                  { value: '', label: 'No winner' },
                  ...experiment.variants.map(v => ({ value: v.id, label: v.name ?? v.id })),
                ]}
              />
            </div>
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>Close Experiment</button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          message={`Close "${experiment.name}"? Its tokens stop working immediately and the split cannot be restarted.`}
          confirmLabel="Close"
          onConfirm={handleClose}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
