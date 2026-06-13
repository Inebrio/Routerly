import { Clock, Zap, FileText, TrendingUp, DollarSign, AlertTriangle, CheckCircle2, XCircle, GitBranch, Cpu } from 'lucide-react';
import type { MessageStats } from '../utils/traceUtils';
import { formatDuration, formatTokensPerSec, formatTokens, formatCost } from '../utils/traceUtils';

interface MessageStatsProps {
  stats: MessageStats;
  turnNumber: number;
  completionModel?: string;
}

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>—</span>;

  const pct = Math.floor(value * 100);
  const color = value >= 0.7 ? '#4ade80' : value >= 0.4 ? '#facc15' : '#f87171';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: '0.8rem', color, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 40 }}>
        {value.toFixed(3)}
      </span>
    </div>
  );
}

export function MessageStatsCard({ stats, turnNumber, completionModel }: MessageStatsProps) {
  const status = stats.hasError ? 'error' : stats.fallbackUsed ? 'fallback' : 'success';
  const hasRoutingInfo = stats.selectedModel != null || stats.routerScore != null;
  const hasCompletionInfo = stats.latencyMs != null || stats.inputTokens != null || completionModel != null;
  const fallbackActive = stats.fallbackUsed && completionModel && completionModel !== stats.selectedModel?.split('/').pop();

  const borderColor =
    status === 'error' ? 'var(--danger)' :
    status === 'fallback' ? '#f59e0b' :
    'var(--border)';

  const borderWidth = status !== 'success' ? '2px' : '1px';

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `${borderWidth} solid ${borderColor}`,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 12,
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: status === 'error'
          ? 'rgba(239,68,68,0.08)'
          : status === 'fallback'
          ? 'rgba(245,158,11,0.07)'
          : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
          TURN #{turnNumber}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* cache badge */}
          {(stats.cacheHit || stats.cacheMiss) && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
              padding: '2px 8px', borderRadius: 99,
              background: stats.cacheHit ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.12)',
              color: stats.cacheHit ? '#10b981' : '#f59e0b',
              border: `1px solid ${stats.cacheHit ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}`,
            }}>
              {stats.cacheHit
                ? `⚡ HIT${stats.cacheSimilarity != null ? ` ${(stats.cacheSimilarity * 100).toFixed(0)}%` : ''}`
                : '○ MISS'}
            </span>
          )}

          {/* latency + cost summary */}
          {stats.latencyMs != null && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(stats.latencyMs)}
            </span>
          )}
          {stats.totalCostUsd != null && (
            <span style={{ fontSize: '0.75rem', color: '#4ade80', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatCost(stats.totalCostUsd)}
            </span>
          )}

          {/* status icon */}
          {status === 'error' && <XCircle size={15} style={{ color: 'var(--danger)' }} />}
          {status === 'fallback' && <AlertTriangle size={15} style={{ color: '#f59e0b' }} />}
          {status === 'success' && <CheckCircle2 size={15} style={{ color: '#10b981' }} />}
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ── Step 1: Routing ── */}
        {hasRoutingInfo && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <GitBranch size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                Routing
              </span>
            </div>

            {stats.selectedModel && (
              <div style={{ marginBottom: stats.routerScore != null ? 8 : 0 }}>
                <span style={{
                  display: 'inline-block',
                  background: fallbackActive ? 'rgba(245,158,11,0.15)' : 'var(--bg-elevated)',
                  color: fallbackActive ? '#f59e0b' : 'var(--text-primary)',
                  border: `1px solid ${fallbackActive ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                  padding: '3px 10px',
                  borderRadius: 5,
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                  fontWeight: 500,
                }}>
                  {stats.selectedModel}
                </span>
              </div>
            )}

            {stats.routerScore != null && <ScoreBar value={stats.routerScore} />}

            {/* Fallback warning inside routing block */}
            {stats.fallbackUsed && stats.errorMessage && (
              <div style={{
                marginTop: 8,
                padding: '6px 10px',
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 5,
                fontSize: '0.75rem',
                color: '#f59e0b',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{stats.errorMessage} — fallback triggered</span>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Completion ── */}
        {hasCompletionInfo && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Cpu size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  Completion
                </span>
              </div>
              {stats.fallbackUsed && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em',
                  padding: '2px 7px', borderRadius: 99,
                  background: 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.35)',
                }}>
                  FALLBACK
                </span>
              )}
            </div>

            {/* Model pill */}
            {completionModel && (
              <div style={{ marginBottom: 10 }}>
                <span style={{
                  display: 'inline-block',
                  background: 'var(--primary)',
                  color: 'white',
                  padding: '4px 12px',
                  borderRadius: 5,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                }}>
                  {completionModel}
                </span>
              </div>
            )}

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Latency</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={11} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatDuration(stats.latencyMs)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>TTFT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={11} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatDuration(stats.ttftMs)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Speed</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingUp size={11} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatTokensPerSec(stats.tokensPerSec)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Tokens</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FileText size={11} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                    {stats.inputTokens != null && stats.outputTokens != null
                      ? `${formatTokens(stats.inputTokens)} / ${formatTokens(stats.outputTokens)}`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cost breakdown */}
            {stats.totalCostUsd != null && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span>
                      <DollarSign size={11} style={{ display: 'inline', marginRight: 3 }} />
                      Input ({stats.inputTokens?.toLocaleString() ?? '—'})
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCost(stats.inputCostUsd)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span>
                      <DollarSign size={11} style={{ display: 'inline', marginRight: 3 }} />
                      Output ({stats.outputTokens?.toLocaleString() ?? '—'})
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCost(stats.outputCostUsd)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 700, paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                    <span>Total</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: '#4ade80' }}>{formatCost(stats.totalCostUsd)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Cached tokens note */}
            {stats.cachedTokens != null && stats.cachedTokens > 0 && (
              <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                💾 Cached: {formatTokens(stats.cachedTokens)} tokens
              </div>
            )}
          </div>
        )}

        {/* ── Fatal error (no completion) ── */}
        {stats.hasError && stats.errorMessage && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            fontSize: '0.78rem',
            color: 'var(--danger)',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}>
            <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            {stats.errorMessage}
          </div>
        )}

      </div>
    </div>
  );
}
