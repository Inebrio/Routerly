import { Clock, Zap, FileText, AlertCircle, TrendingUp, DollarSign, type LucideIcon } from 'lucide-react';
import type { MessageStats } from '../utils/traceUtils';
import { formatDuration, formatTokensPerSec, formatTokens, formatCost } from '../utils/traceUtils';

interface MessageStatsProps {
  stats: MessageStats;
  turnNumber: number;
}

function StatItem({ icon: Icon, label, value, color = 'var(--text-secondary)' }: {
  icon: LucideIcon;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {label}
        </span>
        <span style={{ fontSize: '0.875rem', color, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
      </div>
    </div>
  );
}

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>—</span>;
  
  const pct = Math.floor(value * 100);
  const color = value >= 0.7 ? '#4ade80' : value >= 0.4 ? '#facc15' : '#f87171';
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: '0.875rem', color, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 48 }}>
        {value.toFixed(3)}
      </span>
    </div>
  );
}

export function MessageStatsCard({ stats, turnNumber }: MessageStatsProps) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: stats.hasError ? '2px solid var(--danger)' : '1px solid var(--border)',
      borderRadius: 8,
      padding: 16,
      marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: 12,
        paddingBottom: 12,
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          Turn #{turnNumber}
        </span>
        {stats.hasError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600 }}>
            <AlertCircle size={14} />
            ERROR
          </div>
        )}
      </div>

      {/* Model */}
      {stats.selectedModel && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Selected Model
          </div>
          <div style={{
            background: 'var(--primary)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: '0.875rem',
            fontWeight: 600,
            fontFamily: 'monospace',
            display: 'inline-block',
          }}>
            {stats.selectedModel}
          </div>
        </div>
      )}

      {/* Router Score */}
      {stats.routerScore != null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Router Score
          </div>
          <ScoreBar value={stats.routerScore} />
        </div>
      )}

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <StatItem
          icon={Clock}
          label="Latency"
          value={formatDuration(stats.latencyMs)}
        />
        <StatItem
          icon={Zap}
          label="TTFT"
          value={formatDuration(stats.ttftMs)}
        />
        <StatItem
          icon={TrendingUp}
          label="Speed"
          value={formatTokensPerSec(stats.tokensPerSec)}
        />
        <StatItem
          icon={FileText}
          label="Tokens"
          value={stats.inputTokens != null && stats.outputTokens != null
            ? `${formatTokens(stats.inputTokens)} / ${formatTokens(stats.outputTokens)}`
            : '—'}
        />
      </div>

      {/* Cost Breakdown */}
      {stats.totalCostUsd != null && (
        <div style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Cost Breakdown
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                <DollarSign size={12} style={{ display: 'inline', marginRight: 4 }} />
                Input ({stats.inputTokens?.toLocaleString() ?? '—'} tokens)
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 500 }}>
                {formatCost(stats.inputCostUsd)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                <DollarSign size={12} style={{ display: 'inline', marginRight: 4 }} />
                Output ({stats.outputTokens?.toLocaleString() ?? '—'} tokens)
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 500 }}>
                {formatCost(stats.outputCostUsd)}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 6,
              paddingTop: 8,
              borderTop: '1px dashed var(--border)',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}>
              <span style={{ color: 'var(--text-primary)' }}>Total Cost</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: '#4ade80' }}>
                {formatCost(stats.totalCostUsd)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Cached Tokens */}
      {stats.cachedTokens != null && stats.cachedTokens > 0 && (
        <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          💾 Cached: {formatTokens(stats.cachedTokens)} tokens
        </div>
      )}

      {/* Error Message */}
      {stats.hasError && stats.errorMessage && (
        <div style={{
          marginTop: 12,
          padding: 10,
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 6,
          fontSize: '0.8rem',
          color: 'var(--danger)',
          fontFamily: 'monospace',
        }}>
          {stats.errorMessage}
        </div>
      )}
    </div>
  );
}
