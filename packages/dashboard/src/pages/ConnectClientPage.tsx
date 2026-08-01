import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { buildSnippet, buildMcpSnippet } from '@routerly/shared';
import { getClients } from '../api';
import type { ApiError, ClientListItem } from '../api';
import { ClientLogo } from '../components/ClientLogo';
import { writeToClipboard } from '../utils/clipboard';
import {
  DOCS_BASE, PLACEHOLDER_MCP_TOKEN, PLACEHOLDER_TOKEN,
  SUPPORT_BADGE, SUPPORT_LABEL, isAutoConfigurable,
} from './connectShared';

const CODE_BLOCK: React.CSSProperties = {
  margin: 0, padding: 12, background: 'var(--surface-active)',
  border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem',
  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 10,
};

function CopyBlock({ text }: { text: string }) {
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

export function ConnectClientPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientListItem | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClients()
      .then(res => setClient(res.clients.find(c => c.id === id) ?? null))
      .catch((err: ApiError) => {
        if (err.status === 404) setNotEnabled(true);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const back = (
    <button
      className="btn-icon"
      onClick={() => navigate('/dashboard/connect')}
      style={{ marginBottom: 16, display: 'inline-flex', padding: 4, width: 'fit-content' }}
    >
      <ArrowLeft size={16} />
      <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>Back to Connect</span>
    </button>
  );

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  if (notEnabled || error || !client) {
    return (
      <>
        <div className="page-header">{back}<h1>Connect</h1></div>
        <div className="page-body">
          {error ? (
            <div className="form-error">Failed to load clients: {error}</div>
          ) : (
            <div className="empty-state">
              <Terminal size={40} />
              <p>
                {notEnabled
                  ? <>Client configurator is not enabled. Ask an admin to enable it with <code>routerly modules enable clients</code>.</>
                  : <>No client named <code>{id}</code>.</>}
              </p>
            </div>
          )}
        </div>
      </>
    );
  }

  const snippet = buildSnippet(client, client.baseUrl, PLACEHOLDER_TOKEN);
  const mcpSnippet = client.modes.includes('mcp')
    ? buildMcpSnippet(client, client.baseUrl, PLACEHOLDER_MCP_TOKEN)
    : '';
  const cliCommand = `routerly clients configure ${client.id}`;

  return (
    <>
      <div className="page-header">
        {back}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ClientLogo id={client.id} label={client.label} size={44} />
          <div>
            <h1 style={{ marginBottom: 6 }}>{client.label}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${SUPPORT_BADGE[client.supportState]}`}>{SUPPORT_LABEL[client.supportState]}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{client.wireFormat} wire format</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{client.modes.join(' + ')}</span>
              <a
                href={`${DOCS_BASE}${client.docSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.78rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                Docs <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 900 }}>
        {isAutoConfigurable(client.supportState) && (
          <section>
            <div style={SECTION_TITLE}>Configure from the CLI</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
              Writes {client.configPathHint} on this machine, with a backup you can undo.
            </p>
            <CopyBlock text={cliCommand} />
          </section>
        )}

        {snippet !== '' && (
          <section>
            <div style={SECTION_TITLE}>{client.configKind === 'ui' ? 'Manual steps' : 'Manual setup'}</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
              {client.configKind === 'ui'
                ? `Set these values in ${client.configPathHint}.`
                : <>Put this in <code>{client.configPathHint}</code>.</>}
              {' '}Replace <code>{PLACEHOLDER_TOKEN}</code> with a project token:{' '}
              <Link to="/dashboard/projects">create one</Link> on the Projects page.
            </p>
            <CopyBlock text={snippet} />
          </section>
        )}

        {mcpSnippet !== '' && (
          <section>
            <div style={SECTION_TITLE}>MCP server</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
              Exposes the Routerly tools to {client.label}. Mint the token with{' '}
              <code>routerly mcp token create --label {client.id}</code>, or from your{' '}
              <Link to="/dashboard/profile">profile</Link>.
            </p>
            <CopyBlock text={mcpSnippet} />
          </section>
        )}
      </div>
    </>
  );
}
