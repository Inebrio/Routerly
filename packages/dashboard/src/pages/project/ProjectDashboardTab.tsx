import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Activity, Clock, Coins, PiggyBank } from 'lucide-react';
import { optimizerLabel } from '@routerly/shared';
import { getUsage, type UsageStats } from '../../api';
import { DateRangePicker, RECENT_PRESETS, parseStoredRange, type DateRange } from '../../components/DateRangePicker';
import { useFilterState } from '../../hooks/useFilterState';

const ms = (n: number | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString()} ms`);
const usd = (n: number) => `$${n.toFixed(n !== 0 && Math.abs(n) < 0.0001 ? 8 : 4)}`;

/**
 * Project Dashboard (T62). The first thing a project shows: what the routing
 * saved against the project's own target models, how fast it answered, and how
 * reliable it was. Every figure comes from the same `GET /api/usage` the Logs
 * tab reads, so the two tabs can never disagree.
 */
export function ProjectDashboardTab() {
  const { id: projectId } = useParams<{ id: string }>();

  const [stats, setStats]   = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState('');
  const [dateRange, setDateRange] = useFilterState<DateRange>({
    key: `project-${projectId}-dashboard-dateRange`,
    defaultValue: { from: '', to: '', label: 'This month' },
    deserialize: parseStoredRange,
  });

  const fetchStats = useCallback(() => {
    /* v8 ignore next */
    if (!projectId) return Promise.resolve();
    let from = dateRange.from || undefined;
    let to = dateRange.to || undefined;
    const recentPreset = RECENT_PRESETS.find(p => p.label === dateRange.label);
    if (recentPreset) {
      const fresh = recentPreset.range();
      from = fresh.from;
      to = fresh.to;
    }
    const period = from || to ? 'custom' : 'all';
    // pageSize 1: this tab reads aggregates only, the record list belongs to Logs.
    return getUsage(period, projectId, from, to, 1, 1, { savings: true })
      .then(data => { setStats(data); setErr(''); })
      .catch(e => setErr(e.message));
  }, [projectId, dateRange]);

  useEffect(() => {
    setLoading(true);
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  const summary = stats?.summary;
  const savings = stats?.savings;

  // The headline number is the worst case avoided: the most expensive target
  // the project could have used for the whole window.
  const worst = useMemo(() => {
    if (!savings?.baselines.length) return null;
    return savings.baselines.reduce((a, b) => (b.cost > a.cost ? b : a));
  }, [savings]);

  const models = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byModel).sort((a, b) => b[1].calls - a[1].calls);
  }, [stats]);
  const totalModelCalls = models.reduce((s, [, v]) => s + v.calls, 0);

  const tokensIn = models.reduce((s, [, v]) => s + v.inputTokens, 0);
  const tokensOut = models.reduce((s, [, v]) => s + v.outputTokens, 0);

  return (
    <div style={{ padding: '24px 0', maxWidth: 1100 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{
          fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: 'var(--text-muted)',
        }}>
          Period
        </span>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !summary ? null : summary.totalCalls === 0 ? (
        <div className="empty-state">
          <p>No traffic for this project in the selected period.</p>
        </div>
      ) : (
        <>
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10B981' }}>
                <PiggyBank size={18} /><span className="stat-label">Savings</span>
              </div>
              <div className="stat-value" style={{ color: worst && worst.costDelta >= 0 ? '#10B981' : 'var(--danger)' }}>
                {worst ? usd(worst.costDelta) : '—'}
              </div>
              <div className="stat-sub">
                {worst
                  ? <>vs <span className="mono">{worst.modelId}</span> for everything</>
                  : 'no target model to compare against'}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3D75F5' }}>
                <Coins size={18} /><span className="stat-label">Cost</span>
              </div>
              <div className="stat-value">{usd(summary.totalCost)}</div>
              <div className="stat-sub">{summary.totalCalls.toLocaleString()} calls</div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8B5CF6' }}>
                <Clock size={18} /><span className="stat-label">Latency</span>
              </div>
              <div className="stat-value">{ms(summary.latencyMedianMs)}</div>
              <div className="stat-sub">median &middot; p95 {ms(summary.latencyP95Ms)}</div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#A78BFA' }}>
                <Clock size={18} /><span className="stat-label">Time to first token</span>
              </div>
              <div className="stat-value">{summary.ttftSamples ? ms(summary.ttftMedianMs) : '—'}</div>
              <div className="stat-sub">
                {summary.ttftSamples
                  ? <>median &middot; p95 {ms(summary.ttftP95Ms)}</>
                  : 'not measured on these calls'}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10B981' }}>
                <Activity size={18} /><span className="stat-label">Reliability</span>
              </div>
              <div className="stat-value">
                {((summary.successCalls / summary.totalCalls) * 100).toFixed(1)}%
              </div>
              <div className="stat-sub">
                {summary.errorCalls} errors &middot; {summary.blockedCalls ?? 0} blocked
              </div>
            </div>
          </div>

          {/* Tokens */}
          <div style={{ marginBottom: 24, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Input tokens: <strong style={{ color: 'var(--text-secondary)' }}>{tokensIn.toLocaleString()}</strong></span>
            <span>&middot;</span>
            <span>Output tokens: <strong style={{ color: 'var(--text-secondary)' }}>{tokensOut.toLocaleString()}</strong></span>
            {savings && savings.cache.inputTokens > 0 && (
              <>
                <span>&middot;</span>
                <span>
                  From cache: <strong style={{ color: 'var(--text-secondary)' }}>{savings.cache.inputTokens.toLocaleString()}</strong>
                  {' '}({usd(savings.cache.cost)} saved)
                </span>
              </>
            )}
          </div>

          {/* Counterfactual against the project targets */}
          <h3 className="section-title">If everything had gone to one model</h3>
          {!savings?.baselines.length ? (
            <div className="empty-state">
              <p>Add target models to this project to see the comparison.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>Target model</th>
                    <th style={{ textAlign: 'right' }}>Would have cost</th>
                    <th style={{ textAlign: 'right' }}>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {savings.baselines.map(b => (
                    <tr key={b.modelId}>
                      <td><span className="mono">{b.modelId}</span></td>
                      <td style={{ textAlign: 'right' }}>{usd(b.cost)}</td>
                      <td style={{ textAlign: 'right', color: b.costDelta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {usd(b.costDelta)} ({b.costDeltaPercent.toFixed(1)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '-12px 0 24px' }}>
            Costs are the observed tokens repriced at each target's rates.
          </p>

          {/* What the optimizers actually removed (T63) */}
          {savings && savings.optimizers.length > 0 && (
            <>
              <h3 className="section-title">What the optimizers removed</h3>
              <div className="table-wrap" style={{ marginBottom: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Optimizer</th>
                      <th style={{ textAlign: 'right' }}>Calls changed</th>
                      <th style={{ textAlign: 'right' }}>Tokens saved</th>
                      <th style={{ textAlign: 'right' }}>Cost saved</th>
                      <th style={{ textAlign: 'right' }}>Rolled back</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savings.optimizers.map(o => (
                      <tr key={o.id}>
                        <td>{optimizerLabel(o.id)}</td>
                        <td style={{ textAlign: 'right' }}>{o.calls.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{o.tokensSaved.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: o.costSaved > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                          {usd(o.costSaved)}
                        </td>
                        <td style={{ textAlign: 'right', color: o.rolledBack > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                          {o.rolledBack > 0 ? o.rolledBack.toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 24px' }}>
                Measured on the calls themselves, priced at the model that served each one. A rolled-back
                run means the step's output was rejected as unsafe and the prompt was restored: it saved
                nothing, and a high count means the threshold is too aggressive.
              </p>
            </>
          )}

          {/* Where the traffic went */}
          <h3 className="section-title">Where the traffic went</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: 'right' }}>Calls</th>
                  <th style={{ width: '30%' }}>Share</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>p95 latency</th>
                  <th style={{ textAlign: 'right' }}>Errors</th>
                </tr>
              </thead>
              <tbody>
                {models.map(([modelId, v]) => {
                  const share = totalModelCalls > 0 ? (v.calls / totalModelCalls) * 100 : 0;
                  return (
                    <tr key={modelId}>
                      <td><span className="mono">{modelId}</span></td>
                      <td style={{ textAlign: 'right' }}>{v.calls.toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--border)' }}>
                            <div style={{ width: `${share}%`, height: '100%', borderRadius: 99, background: 'var(--primary)' }} />
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{usd(v.cost)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{ms(v.p95LatencyMs)}</td>
                      <td style={{ textAlign: 'right', color: v.errors > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {v.errors > 0 ? v.errors : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
