/**
 * TraceSummary — the synthetic level of the trace.
 *
 * Renders the `trace:recap` entry the service emits at the end of every request:
 * one glance that says how the call went, what it cost, and which parts of the
 * pipeline had something to say. The detail lives one level below, in TraceLog.
 *
 * Everything here is read from the recap. Nothing is recomputed from the other
 * entries, so this card can never disagree with them.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Route, ShieldAlert, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import type { TraceEntry } from '../api';
import { formatCost, formatDuration, formatTokens, formatTokensPerSec } from '../utils/traceUtils';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

type Outcome = { label: string; color: string; icon: typeof CheckCircle2 };

/** A request that reached no outcome at all reads as incomplete, same as the recap. */
const INCOMPLETE: Outcome = { label: 'incomplete', color: '#f59e0b', icon: AlertTriangle };

const OUTCOMES: Record<string, Outcome> = {
  ok:         { label: 'ok',      color: '#10b981', icon: CheckCircle2 },
  blocked:    { label: 'blocked', color: '#ef4444', icon: ShieldAlert },
  error:      { label: 'error',   color: '#ef4444', icon: XCircle },
  incomplete: INCOMPLETE,
};

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: accent ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

/** One pipeline concern: an icon, a title, and the counters it reported. */
function Section({ icon: Icon, title, color, items }: {
  icon: typeof ShieldCheck; title: string; color: string; items: Array<[string, string]>;
}) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon size={12} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {items.map(([label, value]) => (
          <span key={label} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {label} <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * @param collapsible turn the card into the turn itself: the header stays visible
 *   and clicking it folds everything below, `children` included. A turn still
 *   streaming has no recap yet, and neither has a trace recorded before 0.4.0 —
 *   the card then shows what it knows and keeps the detail reachable.
 * @param defaultOpen whether it starts unfolded (the newest turn does).
 * @param children the detail of this turn, rendered inside the card.
 */
export function TraceSummary({ trace, turn, collapsible = false, defaultOpen = true, children }: {
  trace: TraceEntry[] | undefined;
  turn?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const recap = trace?.find(e => e.message === 'trace:recap');
  // Standalone, with nothing to summarise, the card has nothing to say.
  if (!recap && !collapsible) return null;

  const d = recap?.details ?? {};
  const status = OUTCOMES[str(d.outcome) ?? ''] ?? INCOMPLETE;
  const StatusIcon = status.icon;
  const tokens = obj(d.tokens);
  const cached = num(tokens?.cachedInput) ?? 0;
  const guardrails = obj(d.guardrails);
  const pii = obj(d.pii);
  const optimizers = obj(d.optimizers);
  const overhead = obj(d.overhead);
  const errors = Array.isArray(d.errors) ? (d.errors as Array<Record<string, unknown>>) : [];
  const attempts = num(d.attempts) ?? 0;

  const frame = {
    background: 'var(--bg-elevated)',
    border: `1px solid ${status.color}55`,
    borderRadius: 8,
    overflow: 'hidden',
  };

  const header = (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 14px',
        background: `${status.color}14`,
        borderBottom: '1px solid var(--border)',
      }}>
        {collapsible && (
          <ChevronRight className="trace-turn-chevron" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        )}
        {turn != null && (
          <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
            TURN #{turn}
          </span>
        )}
        <StatusIcon size={15} style={{ color: status.color, flexShrink: 0 }} />
        <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: status.color }}>
          {status.label}
        </span>
        {str(d.model) && (
          <span style={{ fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
            {str(d.model)}
          </span>
        )}
        {str(d.provider) && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{str(d.provider)}</span>
        )}
        {attempts > 1 && (
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 7px', borderRadius: 99 }}>
            {attempts} attempts
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(num(d.durationMs))}
          </span>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
            {formatCost(num(d.costUsd))}
          </span>
        </span>
      </div>
  );

  const body = (
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
          <Metric
            label="Tokens"
            value={tokens ? `${formatTokens(num(tokens.input))} / ${formatTokens(num(tokens.output))}` : '—'}
          />
          {cached > 0 && <Metric label="Cached" value={formatTokens(cached)} accent="#38bdf8" />}
          <Metric label="Latency" value={formatDuration(num(d.latencyMs))} />
          <Metric label="TTFT" value={formatDuration(num(d.ttftMs))} />
          <Metric label="Speed" value={formatTokensPerSec(num(d.tokensPerSec))} />
        </div>

        {(guardrails || pii || optimizers || overhead) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {guardrails && (
              <Section
                icon={guardrails.blockedBy ? ShieldAlert : ShieldCheck}
                title="Guardrails"
                color={guardrails.blockedBy ? '#ef4444' : '#fb923c'}
                items={[
                  ['rules', String(num(guardrails.rules) ?? 0)],
                  ['triggered', String(num(guardrails.triggered) ?? 0)],
                  ['skipped', String(num(guardrails.skipped) ?? 0)],
                  ...((num(guardrails.injected) ?? 0) > 0 ? [['injected', String(guardrails.injected)] as [string, string]] : []),
                  ...(guardrails.blockedBy ? [['blocked by', String(guardrails.blockedBy)] as [string, string]] : []),
                ]}
              />
            )}
            {pii && (
              <Section
                icon={ShieldCheck}
                title="PII"
                color="#34d399"
                items={[
                  ['request', String(num(pii.request) ?? 0)],
                  ['response', String(num(pii.response) ?? 0)],
                ]}
              />
            )}
            {optimizers && (
              <Section
                icon={Sparkles}
                title="Optimizers"
                color="#a78bfa"
                items={[
                  ['steps', String(num(optimizers.steps) ?? 0)],
                  ['applied', String(num(optimizers.applied) ?? 0)],
                  ...((num(optimizers.rolledBack) ?? 0) > 0 ? [['rolled back', String(optimizers.rolledBack)] as [string, string]] : []),
                  ['saved', `${formatTokens(num(optimizers.savedTokens) ?? 0)} tok`],
                ]}
              />
            )}
            {overhead && (
              <Section
                icon={Route}
                title="Router overhead"
                color="#8b5cf6"
                items={[
                  ['calls', String(num(overhead.calls) ?? 0)],
                  ['cost', formatCost(num(overhead.costUsd))],
                ]}
              />
            )}
          </div>
        )}

        {errors.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {errors.map((err, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                fontSize: '0.78rem', color: 'var(--danger)', fontFamily: 'monospace',
              }}>
                <XCircle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                <span><strong>{str(err.model) ?? 'unknown'}</strong>: {str(err.error) ?? 'unknown'}</span>
              </div>
            ))}
          </div>
        )}

        {children}

      </div>
  );

  if (!collapsible) return <div style={frame}>{header}{body}</div>;

  return (
    <details className="trace-turn" open={defaultOpen} style={frame}>
      <summary>{header}</summary>
      {body}
    </details>
  );
}
