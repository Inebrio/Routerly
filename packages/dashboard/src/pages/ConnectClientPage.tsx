import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Terminal } from 'lucide-react';
import { buildSnippet, buildMcpSnippet } from '@routerly/shared';
import { getClients } from '../api';
import type { ApiError, ClientListItem } from '../api';
import { ClientLogo } from '../components/ClientLogo';
import { CopyBlock } from '../components/CopyBlock';
import {
  AUTO_MODEL, DOCS_BASE, MODE_HINT, PLACEHOLDER_MCP_TOKEN, PLACEHOLDER_TOKEN,
  SUPPORT_BADGE, SUPPORT_LABEL, isAutoConfigurable,
} from './connectShared';

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 6,
};

const SECTION_TEXT: React.CSSProperties = {
  fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.55,
};

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
  const autoConfigurable = isAutoConfigurable(client.supportState);

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
              {client.modes.map(mode => (
                <span key={mode} className="badge badge-neutral" title={MODE_HINT[mode]}>
                  {mode.toUpperCase()}
                </span>
              ))}
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
        {autoConfigurable && (
          <section>
            <div style={SECTION_TITLE}>Fastest: one command</div>
            <p style={SECTION_TEXT}>
              Run it on the machine where {client.label} is installed. It writes{' '}
              {client.configPathHint}, keeping a backup you can undo.
            </p>
            <CopyBlock text={cliCommand} />
          </section>
        )}

        {snippet !== '' && (
          <section>
            <div style={SECTION_TITLE}>
              {autoConfigurable ? 'Or set it up by hand' : client.configKind === 'ui' ? 'Set it up by hand' : 'Set up the config file'}
            </div>
            <p style={SECTION_TEXT}>
              {client.configKind === 'ui'
                ? `Set these values in ${client.configPathHint}.`
                : <>Put this in <code>{client.configPathHint}</code>.</>}
              {' '}Replace <code>{PLACEHOLDER_TOKEN}</code> with a router token:{' '}
              <Link to="/dashboard/routers">create one</Link> on the Routers page.
            </p>
            <CopyBlock text={snippet} />
            {client.modes.includes('llm') && (
              <p style={{ ...SECTION_TEXT, margin: '10px 0 0' }}>
                Model: <code>{AUTO_MODEL}</code> hands the choice to Routerly, any model id
                from <Link to="/dashboard/models">Models</Link> works too.
                {client.wireFormat === 'openai' && ' The same base URL, key and model fit any client that offers an "OpenAI compatible" provider.'}
              </p>
            )}
          </section>
        )}

        {mcpSnippet !== '' && (
          <section>
            <div style={SECTION_TITLE}>MCP server</div>
            <p style={SECTION_TEXT}>
              Separate from the steps above: this one lets {client.label} call the
              Routerly tools. It needs a personal MCP token, minted with{' '}
              <code>routerly mcp token create {client.id}</code> or from your{' '}
              <Link to="/dashboard/profile/mcp">profile</Link>.
            </p>
            <CopyBlock text={mcpSnippet} />
          </section>
        )}

        <section>
          <div style={SECTION_TITLE}>Check it worked</div>
          <p style={SECTION_TEXT}>
            Restart {client.label}, send it a prompt, then look for the call in{' '}
            <Link to="/dashboard/usage">Usage</Link>. From the same machine, the CLI
            reports what it finds:
          </p>
          <CopyBlock text="routerly clients doctor" />
        </section>
      </div>
    </>
  );
}
