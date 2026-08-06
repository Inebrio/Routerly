import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeToClipboard } from '../utils/clipboard';

const CODE_BLOCK: React.CSSProperties = {
  margin: 0, padding: 12, background: 'var(--surface-active)',
  border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem',
  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

/** A snippet next to the button that copies it. Used wherever the dashboard
 *  hands out something meant to be pasted somewhere else. */
export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function handleCopy() {
    setError('');
    try {
      await writeToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed, select and copy manually.');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <pre className="mono" style={{ ...CODE_BLOCK, flex: 1 }}>{text}</pre>
        <button type="button" className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0 }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {error && <div className="form-error" style={{ marginTop: 6 }}>{error}</div>}
    </>
  );
}
// RA-16 task 6: trivial change to exercise the shared-component wildcard rule.
