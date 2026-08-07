import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Activity, Clock, Coins, PiggyBank } from 'lucide-react';
import { optimizerLabel } from '@routerly/shared';
import { getUsage, type UsageStats } from '../../api';
import { DateRangePicker, RECENT_PRESETS, parseStoredRange, type DateRange } from '../../components/DateRangePicker';
import { useFilterState } from '../../hooks/useFilterState';

const ms = (n: number | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString()} ms`);
const usd = (n: number) => `$${n.toFixed(n !== 0 && Math.abs(n) < 0.0001 ? 8 : 4)}`;

/**
 * Router Dashboard (T62). The first thing a router shows: what the routing
 * saved against the router's own target models, how fast it answered, and how
 * reliable it was. Every figure comes from the same `GET /api/usage` the Logs
 * tab reads, so the two tabs can never disagree.
 */
export function RouterDashboardTab() {
  const { t } = useTranslation();
  const { id: routerId } = useParams<{ id: string }>();

  const [stats, setStats]   = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState('');
  const [dateRange, setDateRange] = useFilterState<DateRange>({
    key: `router-${routerId}-dashboard-dateRange`,
    defaultValue: { from: '', to: '', label: 'This month' },
    deserialize: parseStoredRange,
  });

  const fetchStats = useCallback(() => {
    /* v8 ignore next */
    if (!routerId) return Promise.resolve();
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
    return getUsage(period, routerId, from, to, 1, 1, { savings: true })
      .then(data => { setStats(data); setErr(''); })
      .catch(e => setErr(e.message));
  }, [routerId, dateRange]);

  useEffect(() => {
    setLoading(true);
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  const summary = stats?.summary;
  const savings = stats?.savings;

  // The headline number is the worst case avoided: the most expensive target
  // the router could have used for the whole window.
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
          {t('routers.dashboard.period')}
        </span>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !summary ? null : summary.totalCalls === 0 ? (
        <div className="empty-state">
          <p>{t('routers.dashboard.noTraffic')}</p>
        </div>
      ) : (
        <>
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10B981' }}>
                <PiggyBank size={18} /><span className="stat-label">{t('routers.dashboard.stats.savings')}</span>
              </div>
              <div className="stat-value" style={{ color: worst && worst.costDelta >= 0 ? '#10B981' : 'var(--danger)' }}>
                {worst ? usd(worst.costDelta) : '—'}
              </div>
              <div className="stat-sub">
                {worst
                  ? <>{t('routers.dashboard.stats.vsPrefix')} <span className="mono">{worst.modelId}</span> {t('routers.dashboard.stats.forEverything')}</>
                  : t('routers.dashboard.stats.noTargetToCompare')}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3D75F5' }}>
                <Coins size={18} /><span className="stat-label">{t('routers.dashboard.stats.cost')}</span>
              </div>
              <div className="stat-value">{usd(summary.totalCost)}</div>
              <div className="stat-sub">{summary.totalCalls === 1 ? t('routers.dashboard.stats.callCount') : t('routers.dashboard.stats.callCount_other', { count: summary.totalCalls })}</div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8B5CF6' }}>
                <Clock size={18} /><span className="stat-label">{t('routers.dashboard.stats.latency')}</span>
              </div>
              <div className="stat-value">{ms(summary.latencyMedianMs)}</div>
              <div className="stat-sub">{t('routers.dashboard.stats.medianP95', { value: ms(summary.latencyP95Ms) })}</div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#A78BFA' }}>
                <Clock size={18} /><span className="stat-label">{t('routers.dashboard.stats.ttft')}</span>
              </div>
              <div className="stat-value">{summary.ttftSamples ? ms(summary.ttftMedianMs) : '—'}</div>
              <div className="stat-sub">
                {summary.ttftSamples
                  ? t('routers.dashboard.stats.medianP95', { value: ms(summary.ttftP95Ms) })
                  : t('routers.dashboard.stats.notMeasured')}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10B981' }}>
                <Activity size={18} /><span className="stat-label">{t('routers.dashboard.stats.reliability')}</span>
              </div>
              <div className="stat-value">
                {((summary.successCalls / summary.totalCalls) * 100).toFixed(1)}%
              </div>
              <div className="stat-sub">
                {t('routers.dashboard.stats.errorsAndBlocked', { errors: summary.errorCalls, blocked: summary.blockedCalls ?? 0 })}
              </div>
            </div>
          </div>

          {/* Tokens */}
          <div style={{ marginBottom: 24, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>{t('routers.dashboard.tokens.input')} <strong style={{ color: 'var(--text-secondary)' }}>{tokensIn.toLocaleString()}</strong></span>
            <span>&middot;</span>
            <span>{t('routers.dashboard.tokens.output')} <strong style={{ color: 'var(--text-secondary)' }}>{tokensOut.toLocaleString()}</strong></span>
            {savings && savings.cache.inputTokens > 0 && (
              <>
                <span>&middot;</span>
                <span>
                  {t('routers.dashboard.tokens.fromCache')} <strong style={{ color: 'var(--text-secondary)' }}>{savings.cache.inputTokens.toLocaleString()}</strong>
                  {' '}{t('routers.dashboard.tokens.cacheSaved', { amount: usd(savings.cache.cost) })}
                </span>
              </>
            )}
          </div>

          {/* Counterfactual against the router targets */}
          <h3 className="section-title">{t('routers.dashboard.oneModel.heading')}</h3>
          {!savings?.baselines.length ? (
            <div className="empty-state">
              <p>{t('routers.dashboard.oneModel.empty')}</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('routers.dashboard.oneModel.columns.targetModel')}</th>
                    <th style={{ textAlign: 'right' }}>{t('routers.dashboard.oneModel.columns.wouldHaveCost')}</th>
                    <th style={{ textAlign: 'right' }}>{t('routers.dashboard.oneModel.columns.saved')}</th>
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
            {t('routers.dashboard.oneModel.costsHint')}
          </p>

          {/* What the optimizers actually removed (T63) */}
          {savings && savings.optimizers.length > 0 && (
            <>
              <h3 className="section-title">{t('routers.dashboard.optimizers.heading')}</h3>
              <div className="table-wrap" style={{ marginBottom: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t('routers.dashboard.optimizers.columns.optimizer')}</th>
                      <th style={{ textAlign: 'right' }}>{t('routers.dashboard.optimizers.columns.callsChanged')}</th>
                      <th style={{ textAlign: 'right' }}>{t('routers.dashboard.optimizers.columns.tokensSaved')}</th>
                      <th style={{ textAlign: 'right' }}>{t('routers.dashboard.optimizers.columns.costSaved')}</th>
                      <th style={{ textAlign: 'right' }}>{t('routers.dashboard.optimizers.columns.rolledBack')}</th>
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
                {t('routers.dashboard.optimizers.hint')}
              </p>
            </>
          )}

          {/* Where the traffic went */}
          <h3 className="section-title">{t('routers.dashboard.traffic.heading')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('routers.dashboard.traffic.columns.model')}</th>
                  <th style={{ textAlign: 'right' }}>{t('routers.dashboard.traffic.columns.calls')}</th>
                  <th style={{ width: '30%' }}>{t('routers.dashboard.traffic.columns.share')}</th>
                  <th style={{ textAlign: 'right' }}>{t('routers.dashboard.traffic.columns.cost')}</th>
                  <th style={{ textAlign: 'right' }}>{t('routers.dashboard.traffic.columns.p95Latency')}</th>
                  <th style={{ textAlign: 'right' }}>{t('routers.dashboard.traffic.columns.errors')}</th>
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
