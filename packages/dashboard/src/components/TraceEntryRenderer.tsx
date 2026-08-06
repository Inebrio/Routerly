import React from 'react';

/**
 * TraceEntryRenderer
 *
 * Renders a single trace entry in a human-readable format.
 *
 * Special handling:
 *  - model:prompt   → highlighted prompt block
 *  - model:thinking → collapsible thinking block
 *  - model:error    → red-bordered JSON block
 *  - everything else → plain JSON pre (technical metadata only, no message content)
 */

interface TraceEntryRendererProps {
  entry: any;
}

function ScoreBar({ value }: { value: number | null | undefined }) {
  // Sanitize: converti stringhe numeriche e gestisci valori invalidi
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  const validValue = typeof numValue === 'number' && !isNaN(numValue) ? numValue : null;

  if (validValue == null) return <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>—</span>;
  const pct = Math.floor(validValue * 100);
  const color = validValue >= 0.7 ? '#4ade80' : validValue >= 0.4 ? '#facc15' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: '0.68rem', color, fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>{validValue.toFixed(3)}</span>
    </div>
  );
}

/** The frame every event-specific block shares: a tinted box with a title. */
function Box({ color, title, badge, children }: { color: string; title: string; badge?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ background: `${color}14`, border: `1px solid ${color}55`, borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

/** label + value pairs on one flowing line: the counters an event reported. */
function Facts({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
      {items.map(([label, value]) => (
        <span key={label} style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {label} <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </span>
      ))}
    </div>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, color, background: `${color}22`, border: `1px solid ${color}55`, padding: '1px 7px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

const OPTIMIZER_COLORS: Record<string, string> = {
  'applied': '#4ade80', 'unchanged': '#94a3b8', 'skipped': '#94a3b8', 'rolled-back': '#f59e0b',
};

export function TraceEntryRenderer({ entry: e }: TraceEntryRendererProps) {
  const isModelPrompt  = e.message === 'model:prompt';
  const isModelRequest = e.message === 'model:request';
  const isModelSuccess = e.message === 'model:success';
  const isError        = e.message === 'model:error';
  const isThinking     = e.message === 'model:thinking';
  const isRecap        = e.message === 'router:recap';
  const isIntake       = e.message === 'router:intake';
  const isCacheEmbedding = e.message === 'cache:embedding';
  const isCacheHit     = e.message === 'cache:hit';
  const isCacheMiss    = e.message === 'cache:miss';
  const isGuardrailTriggered = e.message === 'guardrail:triggered' || e.message === 'guardrail:response-triggered';
  const isGuardrailEvaluated = e.message === 'guardrail:evaluated';
  const isPiiScrubbed  = e.message === 'pii:scrubbed';
  const isPiiEvaluated = e.message === 'pii:evaluated';
  const isGuardrailInjected = e.message === 'guardrail:injected';
  const isOptimizerStep = e.message === 'optimizer:step';
  const isBudgetChecked = e.message === 'budget:checked';
  const isEgressSent   = e.message === 'egress:sent';
  // Events that draw their own titled box: the generic message header would repeat it.
  const isSelfTitled = isRecap || isCacheEmbedding || isCacheHit || isCacheMiss || isGuardrailTriggered
    || isGuardrailEvaluated || isGuardrailInjected || isPiiScrubbed || isPiiEvaluated
    || isOptimizerStep || isBudgetChecked || isEgressSent;

  const labelColor = isError ? 'var(--danger)' : isGuardrailTriggered ? '#ef4444' : isGuardrailEvaluated ? '#fb923c' : isPiiScrubbed ? '#f97316' : isPiiEvaluated ? '#34d399' : isThinking ? '#a78bfa' : isModelPrompt ? '#c4b5fd' : isRecap ? '#34d399' : isCacheEmbedding ? '#38bdf8' : isCacheHit ? '#10b981' : isCacheMiss ? '#f59e0b' : 'var(--accent)';
  const hasDetails = e.details != null && Object.keys(e.details).length > 0;

  // Prompts and answers live in `content` (only present when the router opted in);
  // traces recorded before 0.4.0 still carry them inside `details`.
  const { systemPrompt, responseText, responseJSON, ...baseDetails } = { ...(e.details ?? {}), ...(e.content ?? {}) };
  const thinkingText = String(e.content?.text ?? e.details?.text ?? '');

  const preStyle: React.CSSProperties = {
    margin: 0, padding: 10,
    background: 'var(--bg-surface)',
    border: isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.85rem', overflowX: 'auto',
    color: isError ? 'var(--danger)' : 'var(--text-secondary)',
    whiteSpace: 'pre-wrap',
  };

  const rawDetails = hasDetails ? (
    <details>
      <summary style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>raw details</summary>
      <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify(e.details, null, 2)}</pre>
    </details>
  ) : null;

  return (
    <div style={{ marginBottom: 8 }}>

      {!isSelfTitled && (
        <div style={{ fontSize: '0.75rem', color: labelColor, marginBottom: 3, fontWeight: 700, letterSpacing: '0.04em' }}>
          {e.message}
          {isModelPrompt && (
            <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--text-muted)' }}>
              {e.details.modelId}
            </span>
          )}
        </div>
      )}

      {isModelPrompt ? (
        <details>
          <summary style={{ fontSize: '0.8rem', color: '#c4b5fd', cursor: 'pointer', userSelect: 'none' }}>
            {String(e.details.prompt ?? '').substring(0, 100)}{String(e.details.prompt ?? '').length > 100 ? '…' : ''}
          </summary>
          <pre style={{ ...preStyle, margin: '4px 0 0', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', color: '#c4b5fd' }}>
            {String(e.details.prompt ?? '')}
          </pre>
        </details>

      ) : isThinking ? (
        <details>
          <summary style={{ fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            {thinkingText.substring(0, 80)}
            {thinkingText.length > 80 ? '\u2026' : ''}
          </summary>
          <pre style={{ ...preStyle, margin: '4px 0 0', border: '1px solid rgba(167,139,250,0.3)' }}>
            {thinkingText}
          </pre>
        </details>

      ) : (isModelRequest || isModelSuccess) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Metadati tecnici */}
          <details>
            <summary style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>technical details</summary>
            <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify(baseDetails, null, 2)}</pre>
          </details>

          {/* System prompt sempre espanso (solo chiamate routing) */}
          {systemPrompt != null && (
            <>
              <div style={{ fontSize: '0.75rem', color: '#a5b4fc', fontWeight: 600, marginTop: 2 }}>system prompt</div>
              <pre style={{ ...preStyle, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: '#c4b5fd' }}>
                {String(systemPrompt)}
              </pre>
            </>
          )}

          {/* Response text (solo chiamate routing) */}
          {responseText != null && (
            <>
              <div style={{ fontSize: '0.75rem', color: '#86efac', fontWeight: 600, marginTop: 2 }}>response text</div>
              <pre style={{ ...preStyle, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac' }}>
                {String(responseText)}
              </pre>
            </>
          )}

          {/* Full response JSON collassabile (solo chiamate routing) */}
          {responseJSON != null && (
            <details>
              <summary style={{ fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                response JSON
              </summary>
              <pre style={{ ...preStyle, margin: '4px 0 0' }}>
                {JSON.stringify(responseJSON, null, 2)}
              </pre>
            </details>
          )}

          {rawDetails}
        </div>

      ) : isCacheEmbedding ? (
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.32)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CACHE EMBEDDING CALL</span>
            {e.details?.fallback && (
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#7dd3fc', background: 'rgba(56,189,248,0.14)', padding: '1px 6px', borderRadius: 99 }}>
                fallback #{String(e.details?.attempt ?? '—')}
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Embedding Model</span>
              <span style={{ fontSize: '0.82rem', color: '#e0f2fe', fontFamily: 'monospace', fontWeight: 600 }}>{String(e.details?.modelId ?? '—')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Upstream Model</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{String(e.details?.upstreamModelId ?? '—')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Provider</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{String(e.details?.provider ?? '—')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Source</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{String(e.details?.source ?? '—')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Endpoint</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(e.details?.endpoint ?? '—')}</span>
            </div>
          </div>
          {rawDetails}
        </div>

      ) : isCacheHit ? (
        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CACHE HIT</span>
            {e.details?.ttlExtended && (
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#6ee7b7', background: 'rgba(16,185,129,0.15)', padding: '1px 6px', borderRadius: 99 }}>TTL extended</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model</span>
              <span style={{ fontSize: '0.82rem', color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>{e.details?.modelId ?? '—'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Similarity</span>
              <ScoreBar value={e.details?.similarity} />
            </div>
            {e.details?.embeddingModel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Embedding</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{e.details.embeddingModel}</span>
              </div>
            )}
          </div>
        </div>

      ) : isCacheMiss ? (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CACHE MISS</span>
          {e.details?.embeddingModel && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{e.details.embeddingModel}</span>
          )}
        </div>

      ) : isIntake ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <details>
            <summary style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>details</summary>
            <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify({
              model: e.details?.model,
              messageCount: e.details?.messageCount,
              routerId: e.details?.routerId,
            }, null, 2)}</pre>
          </details>
          {(e.details?.excludedByLimits ?? []).length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 4 }}>EXCLUDED BY LIMITS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {(e.details.excludedByLimits as any[]).map((exc: any, i: number) => (
                  <div key={i} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', padding: '5px 10px' }}>
                    <div style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: 600, marginBottom: exc.violated?.length ? 4 : 0 }}>{exc.model}</div>
                    {(exc.violated ?? []).map((v: any, j: number) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <span style={{ color: '#fca5a5', fontWeight: 600 }}>{v.metric}</span>
                        <span>{v.window}</span>
                        <span style={{ marginLeft: 'auto', color: '#f87171' }}>{v.current} / {v.limit}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {rawDetails}
        </div>

      ) : isRecap ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Final ranking */}
          {e.details?.final?.length > 0 ? (
            <>
              <div style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 2 }}>FINAL RANKING</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {e.details.final.map((f: any) => (
                  <div key={f.rank} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: f.rank === 1 ? '1px solid rgba(52,211,153,0.35)' : '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 10px' }}>
                    <span style={{ fontSize: '0.8rem', color: f.rank === 1 ? '#34d399' : 'var(--text-muted)', fontWeight: f.rank === 1 ? 700 : 400, minWidth: 16 }}>#{f.rank}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.model}</span>
                    <ScoreBar value={f.score ?? f.weight} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 2 }}>FINAL RANKING</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                No ranking data (record may be corrupted or from older version)
              </div>
            </>
          )}
          {/* Per-policy winner table */}
          <div style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 2, marginTop: 16 }}>POLICY SCORES</div>
          {(e.details?.policies ?? []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {e.details.policies.map((p: any, i: number) => (
                <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: p.scores?.length > 1 ? 4 : 0 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                      {p.type === 'llm' ? 'AI Routing' : p.type === 'rate-limit' ? 'Rate Limit' : p.type === 'budget-remaining' ? 'Budget Remaining' : p.type === 'semantic-intent' ? 'Semantic Intent' : p.type === 'model-preference' ? 'Model Preference' : p.type}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>weight {p.weight?.toFixed(2)}</span>
                  </div>
                  {p.winner && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: p.scores?.length > 1 ? 4 : 0 }}>
                    <span style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 600 }}>★ {p.winner.model}</span>
                    <ScoreBar value={p.winner.point ?? p.winner.score} />
                  </div>
                )}
                {p.scores?.length > 1 && (
                  <details>
                    <summary style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>all scores</summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {p.scores.map((s: any, j: number) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.model}</span>
                          <ScoreBar value={s.point ?? s.score} />
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              No policy data (record may be corrupted or from older version)
            </div>
          )}

          {rawDetails}
        </div>

      ) : isGuardrailTriggered ? (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {e.details?.target === 'request' ? 'REQUEST' : 'RESPONSE'} GUARDRAIL {e.details?.block === true ? 'BLOCKED' : 'TRIGGERED'}
            </span>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fca5a5', background: 'rgba(239,68,68,0.12)', padding: '1px 7px', borderRadius: 99, border: '1px solid rgba(239,68,68,0.25)' }}>
              {String(e.details?.target ?? '—')}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Rule</div>
              <div style={{ fontSize: '0.82rem', color: '#fca5a5', fontFamily: 'monospace', fontWeight: 600 }}>{String(e.details?.rule ?? '—')}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Action</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{[e.details?.block && 'block', e.details?.log && 'log'].filter(Boolean).join('+') || '—'}</div>
            </div>
          </div>
          {e.details?.blockMessage && (
            <div style={{ fontSize: '0.8rem', color: '#fca5a5', fontStyle: 'italic', paddingTop: 4, borderTop: '1px solid rgba(239,68,68,0.2)' }}>
              {String(e.details.blockMessage)}
            </div>
          )}
        </div>

      ) : isGuardrailEvaluated ? (
        <div style={{ background: 'rgba(251,146,60,0.07)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            GUARDRAILS EVALUATED ({String(e.details?.target ?? '').toUpperCase()})
            {Array.isArray(e.details?.rules) && (
              <span style={{ fontWeight: 500, marginLeft: 6, color: 'var(--text-muted)' }}>
                {e.details.rules.length} rule{e.details.rules.length !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          {/* Every configured rule, including the ones that never ran: a rule that
              judged nothing is exactly what an operator looks for when a guardrail
              "did nothing". Score next to threshold says how close a pass was. */}
          {Array.isArray(e.details?.rules) && (e.details.rules as Array<any>).map((r, i) => {
            const isInjection = r.rule === 'injection';
            const outcomeColor = r.outcome === 'passed' ? '#4ade80' : r.outcome === 'triggered' ? '#f87171' : 'var(--text-muted)';
            const outcomeBg   = r.outcome === 'passed' ? 'rgba(74,222,128,0.12)' : r.outcome === 'triggered' ? 'rgba(248,113,113,0.12)' : 'rgba(148,163,184,0.10)';
            const outcomeBorder = r.outcome === 'passed' ? 'rgba(74,222,128,0.3)' : r.outcome === 'triggered' ? 'rgba(248,113,113,0.3)' : 'rgba(148,163,184,0.2)';
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap',
                padding: isInjection ? '5px 8px' : '3px 0',
                opacity: r.outcome === 'skipped' ? 0.65 : 1,
                background: isInjection ? 'rgba(239,68,68,0.07)' : undefined,
                border: isInjection ? '1px solid rgba(239,68,68,0.25)' : undefined,
                borderRadius: isInjection ? 'var(--radius-sm)' : undefined,
              }}>
                <span style={{ fontSize: '0.82rem', color: isInjection ? '#fca5a5' : 'var(--text-primary)', fontFamily: 'monospace', fontWeight: isInjection ? 700 : 400, flex: 1, minWidth: 0 }}>
                  {isInjection ? 'Prompt injection' : r.rule}
                </span>
                {r.type && <Pill text={String(r.type)} color="#fb923c" />}
                {r.target && <Pill text={String(r.target)} color="#94a3b8" />}
                {r.injects === true && <Pill text="injects" color="#a78bfa" />}
                {typeof r.score === 'number' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ScoreBar value={r.score} />
                    {typeof r.threshold === 'number' && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        / {r.threshold.toFixed(2)}
                      </span>
                    )}
                  </span>
                )}
                {typeof r.ms === 'number' && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{r.ms} ms</span>
                )}
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: outcomeColor, background: outcomeBg, border: `1px solid ${outcomeBorder}`, padding: '1px 7px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                  {r.outcome}
                </span>
                {r.reason && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', width: '100%', marginTop: 1 }}>
                    {r.reason}
                  </span>
                )}
                {r.judgeRaw && (() => {
                  let parsed: unknown = null;
                  try { parsed = JSON.parse(r.judgeRaw); } catch { /* non-JSON raw */ }
                  return (
                    <details style={{ width: '100%', marginTop: 2 }}>
                      <summary style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>Judge response</summary>
                      <pre style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 8px' }}>
                        {parsed != null ? JSON.stringify(parsed, null, 2) : r.judgeRaw}
                      </pre>
                    </details>
                  );
                })()}
              </div>
            );
          })}
        </div>

      ) : isPiiScrubbed ? (
        <div style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PII SCRUBBED</span>
          {Array.isArray(e.details?.entities) && e.details.entities.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(e.details.entities as string[]).map((entity: string, i: number) => (
                <span key={i} style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fdba74', background: 'rgba(249,115,22,0.12)', padding: '2px 8px', borderRadius: 99, border: '1px solid rgba(249,115,22,0.25)' }}>
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>

      ) : isPiiEvaluated ? (() => {
        // "0 redacted" only means something next to what was looked for: which
        // policies were active, which entity types they cover, how much text they saw.
        const counts = (e.details?.counts ?? {}) as Record<string, number>;
        const redacted = Array.isArray(e.details?.redacted) ? (e.details.redacted as string[]) : [];
        const entities = Array.isArray(e.details?.entities) ? (e.details.entities as string[]) : [];
        const policies = e.details?.policies as { configured?: number; active?: number } | undefined;
        return (
          <Box
            color={redacted.length > 0 ? '#f97316' : '#34d399'}
            title={`PII SCANNED (${String(e.details?.target ?? e.panel ?? '').toUpperCase()})`}
            badge={e.details?.mode ? <Pill text={String(e.details.mode)} color="#94a3b8" /> : undefined}
          >
            <Facts items={[
              ...(policies ? [['policies', `${policies.active ?? 0}/${policies.configured ?? 0}`] as [string, React.ReactNode]] : []),
              ['entity types', entities.length],
              ...(e.details?.customPatterns ? [['custom patterns', String(e.details.customPatterns)] as [string, React.ReactNode]] : []),
              ...(e.details?.scanned != null ? [['scanned', String(e.details.scanned)] as [string, React.ReactNode]] : []),
              ['redacted', redacted.length],
              ...(e.details?.ms != null ? [['took', `${String(e.details.ms)} ms`] as [string, React.ReactNode]] : []),
            ]} />
            {redacted.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {redacted.map((entity: string, i: number) => (
                  <span key={i} style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fdba74', background: 'rgba(249,115,22,0.12)', padding: '2px 8px', borderRadius: 99, border: '1px solid rgba(249,115,22,0.25)' }}>
                    {entity}{counts[entity] != null ? ` ×${counts[entity]}` : ''}
                  </span>
                ))}
              </div>
            )}
            {entities.length > 0 && (
              <details>
                <summary style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>entity types scanned</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {entities.map((entity: string, i: number) => (
                    <span key={i} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 99 }}>
                      {entity}
                    </span>
                  ))}
                </div>
              </details>
            )}
          </Box>
        );
      })()

      : isGuardrailInjected ? (
        <Box color="#a78bfa" title="GUARDRAIL INJECTION" badge={<Pill text={String(e.details?.target ?? 'request')} color="#94a3b8" />}>
          <Facts items={[
            ['rules', Array.isArray(e.details?.rules) ? e.details.rules.length : 0],
            ['chars', String(e.details?.chars ?? 0)],
          ]} />
          {Array.isArray(e.details?.rules) && e.details.rules.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {/* Since 0.4.0 each rule is `{ index, rule }`; older traces stored a bare string. */}
              {(e.details.rules as Array<string | { rule?: unknown }>).map((r, i) => (
                <Pill key={i} text={String(typeof r === 'object' && r !== null ? r.rule ?? '' : r)} color="#a78bfa" />
              ))}
            </div>
          )}
          {/* The injected text itself is captured only for routers that opted in. */}
          {e.content?.injection != null && (
            <details>
              <summary style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>injected text</summary>
              <pre style={{ ...preStyle, margin: '4px 0 0', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd' }}>
                {String(e.content.injection)}
              </pre>
            </details>
          )}
        </Box>

      ) : isOptimizerStep ? (
        <Box
          color={OPTIMIZER_COLORS[String(e.details?.outcome)] ?? '#94a3b8'}
          title={`OPTIMIZER ${String(e.details?.id ?? '')}`}
          badge={<>
            <Pill text={String(e.details?.outcome ?? '')} color={OPTIMIZER_COLORS[String(e.details?.outcome)] ?? '#94a3b8'} />
            {e.details?.klass && <Pill text={String(e.details.klass)} color="#94a3b8" />}
          </>}
        >
          <Facts items={[
            ...(e.details?.tokensBefore != null
              ? [['tokens', `${String(e.details.tokensBefore)} → ${String(e.details.tokensAfter ?? e.details.tokensBefore)}`] as [string, React.ReactNode]]
              : []),
            ...(e.details?.saved != null ? [['saved', `${String(e.details.saved)} tok`] as [string, React.ReactNode]] : []),
            ...(e.details?.ms != null ? [['took', `${String(e.details.ms)} ms`] as [string, React.ReactNode]] : []),
            ...(e.details?.reason ? [['reason', String(e.details.reason)] as [string, React.ReactNode]] : []),
          ]} />
        </Box>

      ) : isBudgetChecked ? (
        <Box
          color={e.details?.allowed === false ? '#ef4444' : '#4ade80'}
          title={e.details?.allowed === false ? 'BUDGET BLOCKED' : 'BUDGET OK'}
          badge={<Pill text={String(e.details?.model ?? '—')} color={e.details?.allowed === false ? '#ef4444' : '#4ade80'} />}
        >
          {e.details?.ms != null && <Facts items={[['took', `${String(e.details.ms)} ms`]]} />}
          {Array.isArray(e.details?.violated) && (e.details.violated as any[]).map((v: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <span style={{ color: '#fca5a5', fontWeight: 600 }}>{String(v.metric)}</span>
              <span>{String(v.window)}</span>
              <span style={{ marginLeft: 'auto', color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>{String(v.current)} / {String(v.limit)}</span>
            </div>
          ))}
        </Box>

      ) : isEgressSent ? (
        <Box
          color={e.details?.error ? '#ef4444' : '#0ea5e9'}
          title="EGRESS SENT"
          badge={<>
            <Pill text={String(e.details?.kind ?? '')} color={e.details?.error ? '#ef4444' : '#0ea5e9'} />
            {e.details?.protocol && <Pill text={String(e.details.protocol)} color="#94a3b8" />}
          </>}
        >
          <Facts items={[
            ...(e.details?.status != null ? [['status', String(e.details.status)] as [string, React.ReactNode]] : []),
            ...(e.details?.encoding ? [['encoding', String(e.details.encoding)] as [string, React.ReactNode]] : []),
            ...(e.details?.frames != null ? [['frames', String(e.details.frames)] as [string, React.ReactNode]] : []),
            ...(e.details?.bytes != null ? [['bytes', String(e.details.bytes)] as [string, React.ReactNode]] : []),
          ]} />
          {e.details?.error && (
            <div style={{ fontSize: '0.78rem', color: 'var(--danger)', fontFamily: 'monospace' }}>{String(e.details.error)}</div>
          )}
        </Box>

      ) : (
        <details>
          <summary style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>raw details</summary>
          <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify(e.details, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
