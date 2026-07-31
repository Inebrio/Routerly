import { useEffect, useState } from 'react';
import { Wrench, ShieldOff } from 'lucide-react';
import { getMcpTools, type McpToolRow } from '../api';
import { useAuth } from '../AuthContext';

const HTTP_ENDPOINT = `${window.location.origin}/mcp`;

export function McpPage() {
  const { can } = useAuth();
  const canRead = can('mcp:read');

  const [tools, setTools] = useState<McpToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const rows = await getMcpTools();
      setTools(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MCP tools');
    } finally {
      setLoading(false);
    }
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>MCP Tools</h1>
          <p>Model Context Protocol tools exposed to your MCP clients</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view MCP tools.</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>MCP Tools</h1>
        <p>Model Context Protocol tools exposed to your MCP clients</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {tools.length} tool{tools.length !== 1 ? 's' : ''}
              </span>
            </div>

            {tools.length === 0 ? (
              <div className="empty-state"><Wrench size={40} /><p>No MCP tools available.</p></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Scope</th>
                      <th>Description</th>
                      <th>Source module</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map(t => (
                      <tr key={t.name}>
                        <td><span className="mono" style={{ fontSize: '0.82rem' }}>{t.name}</span></td>
                        <td><span className={`badge badge-${t.scope === 'write' ? 'warning' : 'success'}`}>{t.scope}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t.description}</span></td>
                        <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.sourceModule}</span></td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: t.enabled ? 'var(--success)' : 'var(--text-muted)' }}>
                            {t.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ConnectionInstructions />
          </>
        )}
      </div>
    </>
  );
}

function ConnectionInstructions() {
  return (
    <div className="card" style={{ padding: 20, marginTop: 24, borderRadius: 8, border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>Connect an MCP client</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
        Two transports are available. Use stdio for local desktop clients (Claude Desktop and similar); use HTTP for remote clients.
      </p>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>stdio (local)</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
          Run the CLI wrapper; it launches the stdio transport for you:
        </p>
        <pre className="mono" style={{
          margin: 0, padding: 12, background: 'var(--surface-active)',
          border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem',
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>routerly mcp serve</pre>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          Internally this runs the service with <span className="mono">ROUTERLY_MCP_STDIO=1</span> and{' '}
          <span className="mono">ROUTERLY_MCP_TOKEN=&lt;project token&gt;</span> — set those yourself only if you run the service directly instead of via the CLI.
        </p>
      </div>

      <div>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>HTTP (remote)</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
          JSON-RPC 2.0 over Streamable HTTP at:
        </p>
        <pre className="mono" style={{
          margin: 0, padding: 12, background: 'var(--surface-active)',
          border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem',
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{HTTP_ENDPOINT}</pre>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          Authenticate with <span className="mono">Authorization: Bearer &lt;project token&gt;</span>. The token must carry the{' '}
          <span className="mono">mcp</span> scope; write tools additionally require <span className="mono">mcp:write</span>.
        </p>
      </div>
    </div>
  );
}
