import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Terminal } from 'lucide-react';
import { getClients } from '../api';
import type { ApiError, ClientListItem } from '../api';
import { ClientLogo } from '../components/ClientLogo';
import { CopyBlock } from '../components/CopyBlock';
import { AUTO_MODEL, MODE_HINT, SUPPORT_BADGE, SUPPORT_LABEL, isAutoConfigurable, gatewayRoot } from './connectShared';

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
      .catch((err: ApiError) => {
        // Only a confirmed 404 (module disabled) hides the nav link; any other
        // error (network, 500, timeout) leaves `enabled` unresolved (null)
        // rather than looking identical to "genuinely disabled".
        if (!cancelled && err.status === 404) setEnabled(false);
      });
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

function ClientTile({ client }: { client: ClientListItem }) {
  return (
    <Link
      to={`/dashboard/connect/${client.id}`}
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'inherit' }}
    >
      <ClientLogo id={client.id} label={client.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>{client.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${SUPPORT_BADGE[client.supportState]}`}>{SUPPORT_LABEL[client.supportState]}</span>
          {client.modes.map(mode => (
            <span key={mode} className="badge badge-neutral" title={MODE_HINT[mode]}>
              {mode.toUpperCase()}
            </span>
          ))}
        </div>
      </div>
      <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </Link>
  );
}

const GROUP_TITLE: CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 4,
};

const ROW_LABEL: CSSProperties = {
  fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', paddingTop: 10,
};

function EndpointRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div style={ROW_LABEL}>{label}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </>
  );
}

/**
 * The generic setup, for anything the grid below does not name: base URL, key
 * and model are all a client needs, because Routerly speaks the two SDK wire
 * formats as they are.
 */
function EndpointCard({ baseUrl }: { baseUrl: string }) {
  const root = gatewayRoot(baseUrl);
  const note: CSSProperties = { fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 };

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={GROUP_TITLE}>Point any client here</div>
        <p style={{ ...note, marginTop: 4 }}>
          Anything built on the OpenAI or Anthropic SDK works by changing the base URL
          and the key. Nothing else changes: requests and responses cross Routerly as they are.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: '10px 16px', alignItems: 'start' }}>
        <EndpointRow label="OpenAI base URL"><CopyBlock text={`${root}/v1`} /></EndpointRow>
        <EndpointRow label="Anthropic base URL"><CopyBlock text={root} /></EndpointRow>
        <EndpointRow label="API key">
          <p style={{ ...note, paddingTop: 10 }}>
            A project token, sent as <code>Authorization: Bearer</code> or <code>x-api-key</code>.{' '}
            <Link to="/dashboard/projects">Create one</Link> on the Projects page.
          </p>
        </EndpointRow>
        <EndpointRow label="Model">
          <p style={{ ...note, paddingTop: 10 }}>
            <code>{AUTO_MODEL}</code> lets Routerly pick. Any model id from the{' '}
            <Link to="/dashboard/models">Models</Link> page works too.
          </p>
        </EndpointRow>
      </div>
    </section>
  );
}

function ClientGroup({ title, hint, clients }: { title: string; hint: string; clients: ClientListItem[] }) {
  if (clients.length === 0) return null;
  return (
    <section>
      <div style={GROUP_TITLE}>{title}</div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>{hint}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {clients.map(c => <ClientTile key={c.id} client={c} />)}
      </div>
    </section>
  );
}

export function ConnectPage() {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClients()
      .then(res => setClients(res.clients))
      .catch((err: ApiError) => {
        if (err.status === 404) setNotEnabled(true);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>Connect</h1>
        <p>
          Point an AI coding client at this gateway. Pick a client for its setup steps.
          <br />
          <strong>LLM</strong> routes that client model traffic through Routerly.{' '}
          <strong>MCP</strong> loads Routerly as a tool server inside it.
        </p>
      </div>
      <div className="page-body">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : notEnabled ? (
          <div className="empty-state">
            <Terminal size={40} />
            <p>
              Client configurator is not enabled. Ask an admin to enable it with{' '}
              <code>routerly modules enable clients</code>.
            </p>
          </div>
        ) : error ? (
          <div className="form-error">Failed to load clients: {error}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {clients?.[0] && <EndpointCard baseUrl={clients[0].baseUrl} />}
            <ClientGroup
              title="One command"
              hint="The CLI writes the config file for you, with a backup you can undo."
              clients={(clients ?? []).filter(c => isAutoConfigurable(c.supportState))}
            />
            <ClientGroup
              title="By hand"
              hint="Copy the snippet from the client page into its settings, then restart it."
              clients={(clients ?? []).filter(c => !isAutoConfigurable(c.supportState))}
            />
          </div>
        )}
      </div>
    </>
  );
}
