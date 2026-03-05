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
  const isModelPrompt = e.message === 'model:prompt';
  const isError       = e.message === 'model:error';
  const isThinking    = e.message === 'model:thinking';

  const labelColor = isError ? 'var(--danger)' : isThinking ? '#a78bfa' : isModelPrompt ? '#c4b5fd' : 'var(--accent)';

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
        <pre style={{
          margin: 0, padding: 10,
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.72rem', overflowX: 'auto',
          color: '#c4b5fd', whiteSpace: 'pre-wrap',
        }}>
          {String(e.details.prompt ?? '')}
        </pre>
      ) : isThinking ? (
        <details>
          <summary style={{ fontSize: '0.68rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            {String(e.details?.text ?? '').substring(0, 80)}
            {String(e.details?.text ?? '').length > 80 ? '\u2026' : ''}
          </summary>
          <pre style={{
            margin: '4px 0 0', padding: 10,
            background: 'var(--bg-surface)',
            border: '1px solid rgba(167,139,250,0.3)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.72rem', overflowX: 'auto',
            color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
          }}>
            {String(e.details?.text ?? '')}
          </pre>
        </details>
      ) : (
        <pre style={{
          margin: 0, padding: 10,
          background: 'var(--bg-surface)',
          border: isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.72rem', overflowX: 'auto',
          color: isError ? 'var(--danger)' : 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
        }}>
          {JSON.stringify(e.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
