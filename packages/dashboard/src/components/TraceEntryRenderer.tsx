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

export function TraceEntryRenderer({ entry: e }: TraceEntryRendererProps) {
  const isModelPrompt  = e.message === 'model:prompt';
  const isModelRequest = e.message === 'model:request';
  const isModelSuccess = e.message === 'model:success';
  const isError        = e.message === 'model:error';
  const isThinking     = e.message === 'model:thinking';
  const isRecap        = e.message === 'router:recap';
  const isIntake       = e.message === 'router:intake';

  const labelColor = isError ? 'var(--danger)' : isThinking ? '#a78bfa' : isModelPrompt ? '#c4b5fd' : isRecap ? '#34d399' : 'var(--accent)';

  // Estrai i campi "speciali" dal JSON tecnico per non duplicarli nel fallback
  const { systemPrompt, responseText, responseJSON, ...baseDetails } = e.details ?? {};

  const preStyle: React.CSSProperties = {
    margin: 0, padding: 10,
    background: 'var(--bg-surface)',
    border: isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.72rem', overflowX: 'auto',
    color: isError ? 'var(--danger)' : 'var(--text-secondary)',
    whiteSpace: 'pre-wrap',
  };

  return (
    <div style={{ marginBottom: 8 }}>

      {!isRecap && (
        <div style={{ fontSize: '0.6rem', color: labelColor, marginBottom: 3, fontWeight: 700, letterSpacing: '0.04em' }}>
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
          <summary style={{ fontSize: '0.62rem', color: '#c4b5fd', cursor: 'pointer', userSelect: 'none' }}>
            {String(e.details.prompt ?? '').substring(0, 100)}{String(e.details.prompt ?? '').length > 100 ? '…' : ''}
          </summary>
          <pre style={{ ...preStyle, margin: '4px 0 0', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', color: '#c4b5fd' }}>
            {String(e.details.prompt ?? '')}
          </pre>
        </details>

      ) : isThinking ? (
        <details>
          <summary style={{ fontSize: '0.68rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            {String(e.details?.text ?? '').substring(0, 80)}
            {String(e.details?.text ?? '').length > 80 ? '\u2026' : ''}
          </summary>
          <pre style={{ ...preStyle, margin: '4px 0 0', border: '1px solid rgba(167,139,250,0.3)' }}>
            {String(e.details?.text ?? '')}
          </pre>
        </details>

      ) : (isModelRequest || isModelSuccess) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Metadati tecnici */}
          <details>
            <summary style={{ fontSize: '0.62rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>technical details</summary>
            <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify(baseDetails, null, 2)}</pre>
          </details>

          {/* System prompt sempre espanso (solo chiamate routing) */}
          {systemPrompt != null && (
            <>
              <div style={{ fontSize: '0.6rem', color: '#a5b4fc', fontWeight: 600, marginTop: 2 }}>system prompt</div>
              <pre style={{ ...preStyle, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: '#c4b5fd' }}>
                {String(systemPrompt)}
              </pre>
            </>
          )}

          {/* Response text (solo chiamate routing) */}
          {responseText != null && (
            <>
              <div style={{ fontSize: '0.6rem', color: '#86efac', fontWeight: 600, marginTop: 2 }}>response text</div>
              <pre style={{ ...preStyle, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac' }}>
                {String(responseText)}
              </pre>
            </>
          )}

          {/* Full response JSON collassabile (solo chiamate routing) */}
          {responseJSON != null && (
            <details>
              <summary style={{ fontSize: '0.68rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                response JSON
              </summary>
              <pre style={{ ...preStyle, margin: '4px 0 0' }}>
                {JSON.stringify(responseJSON, null, 2)}
              </pre>
            </details>
          )}
        </div>

      ) : isIntake ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <details>
            <summary style={{ fontSize: '0.62rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>details</summary>
            <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify({
              model: e.details?.model,
              messageCount: e.details?.messageCount,
              projectId: e.details?.projectId,
            }, null, 2)}</pre>
          </details>
          {(e.details?.excludedByLimits ?? []).length > 0 && (
            <div>
              <div style={{ fontSize: '0.6rem', color: '#f87171', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 4 }}>EXCLUDED BY LIMITS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {(e.details.excludedByLimits as any[]).map((exc: any, i: number) => (
                  <div key={i} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', padding: '5px 10px' }}>
                    <div style={{ fontSize: '0.68rem', color: '#f87171', fontWeight: 600, marginBottom: exc.violated?.length ? 4 : 0 }}>{exc.model}</div>
                    {(exc.violated ?? []).map((v: any, j: number) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.62rem', color: 'var(--text-muted)' }}>
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
        </div>

      ) : isRecap ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Final ranking */}
          {e.details?.final?.length > 0 ? (
            <>
              <div style={{ fontSize: '0.6rem', color: '#34d399', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 2 }}>FINAL RANKING</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {e.details.final.map((f: any) => (
                  <div key={f.rank} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: f.rank === 1 ? '1px solid rgba(52,211,153,0.35)' : '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 10px' }}>
                    <span style={{ fontSize: '0.65rem', color: f.rank === 1 ? '#34d399' : 'var(--text-muted)', fontWeight: f.rank === 1 ? 700 : 400, minWidth: 16 }}>#{f.rank}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.model}</span>
                    <ScoreBar value={f.score ?? f.weight} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.6rem', color: '#34d399', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 2 }}>FINAL RANKING</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                No ranking data (record may be corrupted or from older version)
              </div>
            </>
          )}
          {/* Per-policy winner table */}
          <div style={{ fontSize: '0.6rem', color: '#34d399', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 2, marginTop: 16 }}>POLICY SCORES</div>
          {(e.details?.policies ?? []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {e.details.policies.map((p: any, i: number) => (
                <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: p.scores?.length > 1 ? 4 : 0 }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                      {p.type === 'llm' ? 'AI Routing' : p.type === 'rate-limit' ? 'Rate Limit' : p.type === 'budget-remaining' ? 'Budget Remaining' : p.type}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>weight {p.weight?.toFixed(2)}</span>
                  </div>
                  {p.winner && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: p.scores?.length > 1 ? 4 : 0 }}>
                    <span style={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 600 }}>★ {p.winner.model}</span>
                    <ScoreBar value={p.winner.point ?? p.winner.score} />
                  </div>
                )}
                {p.scores?.length > 1 && (
                  <details>
                    <summary style={{ fontSize: '0.62rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>all scores</summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {p.scores.map((s: any, j: number) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.model}</span>
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
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              No policy data (record may be corrupted or from older version)
            </div>
          )}
        </div>

      ) : (
        <details>
          <summary style={{ fontSize: '0.62rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>details</summary>
          <pre style={{ ...preStyle, margin: '4px 0 0' }}>{JSON.stringify(e.details, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
