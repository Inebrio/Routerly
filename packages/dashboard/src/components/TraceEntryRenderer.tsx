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

export function TraceEntryRenderer({ entry: e }: TraceEntryRendererProps) {
  const isModelPrompt  = e.message === 'model:prompt';
  const isModelRequest = e.message === 'model:request';
  const isModelSuccess = e.message === 'model:success';
  const isError        = e.message === 'model:error';
  const isThinking     = e.message === 'model:thinking';

  const labelColor = isError ? 'var(--danger)' : isThinking ? '#a78bfa' : isModelPrompt ? '#c4b5fd' : 'var(--accent)';

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

      <div style={{ fontSize: '0.6rem', color: labelColor, marginBottom: 3, fontWeight: 700, letterSpacing: '0.04em' }}>
        {e.message}
        {isModelPrompt && (
          <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--text-muted)' }}>
            {e.details.modelId}
          </span>
        )}
      </div>

      {isModelPrompt ? (
        <pre style={{ ...preStyle, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', color: '#c4b5fd' }}>
          {String(e.details.prompt ?? '')}
        </pre>

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
          <pre style={preStyle}>{JSON.stringify(baseDetails, null, 2)}</pre>

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

      ) : (
        <pre style={preStyle}>
          {JSON.stringify(e.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
