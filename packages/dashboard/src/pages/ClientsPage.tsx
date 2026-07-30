import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, ExternalLink, Terminal } from 'lucide-react';
import { getClients } from '../api';
import type { ClientListItem, SupportState } from '../api';

const DOCS_BASE = 'https://doc.routerly.ai/next/';
const PLACEHOLDER_TOKEN = '<YOUR_ROUTERLY_TOKEN>';

const SUPPORT_BADGE: Record<SupportState, string> = {
  'auto-configurable': 'badge-success',
  launchable: 'badge-success',
  documented: 'badge-warning',
  partial: 'badge-warning',
  stale: 'badge-error',
};

/**
 * Fetches GET /api/clients once and reports whether the client-configurator
 * module is enabled (null = unresolved). Used to gate the sidebar nav link:
 * no link while unresolved, no link at all once resolved disabled.
 */
export function useClientsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getClients()
      .then(() => { if (!cancelled) setEnabled(true); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

/**
 * Lightweight dashboard-side snippet builder (placeholder token, not a real
 * one — the dashboard never has a project's raw token). Mirrors the shape of
 * @routerly/shared's buildSnippet() closely enough to be useful; not byte-
 * identical, that function is for CLI/service internal use with a real token.
 */
function buildDashboardSnippet(client: ClientListItem): string {
  const baseUrl = client.wireFormat === 'anthropic' ? client.anthropicBaseUrl : client.openaiBaseUrl;
  switch (client.configKind) {
    case 'env':
      return client.wireFormat === 'anthropic'
        ? `ANTHROPIC_BASE_URL=${baseUrl}\nANTHROPIC_AUTH_TOKEN=${PLACEHOLDER_TOKEN}`
        : `OPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=${PLACEHOLDER_TOKEN}`;
    case 'json':
      return client.wireFormat === 'anthropic'
        ? JSON.stringify({ env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: PLACEHOLDER_TOKEN } }, null, 2)
        : JSON.stringify({ provider: { routerly: { options: { baseURL: baseUrl, apiKey: PLACEHOLDER_TOKEN } } } }, null, 2);
    case 'yaml':
      return [
        'models:',
        '  - name: Routerly (auto-routed)',
        '    provider: openai',
        '    model: routerly/ada',
        `    apiBase: ${baseUrl}`,
        `    apiKey: ${PLACEHOLDER_TOKEN}`,
      ].join('\n');
    case 'toml':
      return [
        'model_provider = "routerly"',
        '',
        '[model_providers.routerly]',
        `base_url = "${baseUrl}"`,
        'wire_api = "responses"',
        `experimental_bearer_token = "${PLACEHOLDER_TOKEN}"`,
      ].join('\n');
    case 'ui':
      return '';
    default: {
      const _exhaustive: never = client.configKind;
      return _exhaustive;
    }
  }
}

/** Copy-to-clipboard with the execCommand textarea fallback for non-secure
 * contexts (HTTP, self-hosted via bare LAN IP) — same logic as
 * ProjectTokenCreatePage's copyToClipboard(). */
async function copyText(text: string, onDone: () => void, onError: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onDone();
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (ok) onDone(); else onError('Copy failed - select and copy manually.');
    } catch {
      onError('Copy failed - select and copy manually.');
    }
  }
}

function ClientCard({ client }: { client: ClientListItem }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const snippet = buildDashboardSnippet(client);
  const docsUrl = `${DOCS_BASE}${client.docSlug}`;

  function handleCopy() {
    setCopyError('');
    void copyText(snippet, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, setCopyError);
  }

  return (
    <div className="card" style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{client.label}</h3>
        <span className={`badge ${SUPPORT_BADGE[client.supportState]}`}>{client.supportState}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{client.wireFormat}</span>
        <a href={docsUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Docs <ExternalLink size={12} />
        </a>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        {client.configKind === 'ui'
          ? `Configure via ${client.configPathHint}, no file to edit.`
          : `Config file: ${client.configPathHint}`}
      </p>
      {client.configKind !== 'ui' && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <pre className="mono" style={{
              flex: 1, margin: 0, padding: 12, background: 'var(--surface-active)',
              border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem',
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {snippet}
            </pre>
            <button type="button" className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0 }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {copyError && <div className="form-error" style={{ marginTop: 6 }}>{copyError}</div>}
        </>
      )}
    </div>
  );
}

export function ClientsPage() {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClients()
      .then(res => setClients(res.clients))
      .catch((err: Error & { status?: number }) => {
        if (err.status === 404) setNotEnabled(true);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>Client Configurators</h1>
        <p>
          Copy-paste config snippets for AI coding clients. To auto-apply configuration on this
          machine instead, use the CLI: <code>routerly clients configure &lt;id&gt;</code>.
        </p>
      </div>
      <div className="page-body">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : notEnabled ? (
          <div className="empty-state">
            <Terminal size={40} />
            <p>
              Client configurator is not enabled. Ask an admin to enable it from{' '}
              <Link to="/dashboard/settings/modules">Settings &rarr; Modules</Link>.
            </p>
          </div>
        ) : error ? (
          <div style={{ color: 'var(--danger)' }}>Failed to load clients: {error}</div>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
              Paste your project token in place of <code>{PLACEHOLDER_TOKEN}</code>. Need one?{' '}
              <Link to="/dashboard/projects">Create a token</Link> on the Projects page.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(clients ?? []).map(c => <ClientCard key={c.id} client={c} />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}
