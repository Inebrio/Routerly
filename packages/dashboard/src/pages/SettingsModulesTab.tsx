import { useEffect, useState } from 'react';
import { getModules, enableModule, disableModule } from '../api';
import type { ModuleInfo } from '../api';

export function SettingsModulesTab() {
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  async function load() {
    try {
      setError(null);
      setModules(await getModules());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(m: ModuleInfo) {
    setBusy(m.id);
    setError(null);
    try {
      const res = m.enabled ? await disableModule(m.id) : await enableModule(m.id);
      if (res.restartRequired) setRestartRequired(true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !modules) {
    return <div style={{ color: 'var(--danger)' }}>Failed to load modules: {error}</div>;
  }
  if (!modules) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading modules...</div>;
  }
  if (modules.length === 0) {
    return <div style={{ color: 'var(--text-secondary)' }}>No modules registered.</div>;
  }

  return (
    <div>
      {restartRequired && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            borderRadius: 8,
            background: 'rgba(234,179,8,0.12)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        >
          Module changes require a service restart to take effect. Restart the Routerly service
          (for Docker: <code>docker restart &lt;container&gt;</code>; otherwise stop and re-run the
          service process).
        </div>
      )}
      {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
            <th style={{ padding: '8px 12px' }}>Module</th>
            <th style={{ padding: '8px 12px' }}>Version</th>
            <th style={{ padding: '8px 12px' }}>Depends on</th>
            <th style={{ padding: '8px 12px' }}>State</th>
            <th style={{ padding: '8px 12px' }} />
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px', fontWeight: 500 }}>{m.id}</td>
              <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{m.version}</td>
              <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                {m.dependsOn.join(', ') || '-'}
              </td>
              <td style={{ padding: '8px 12px' }}>
                {m.enabled ? 'Enabled' : 'Disabled'}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                {m.alwaysOn ? (
                  <span style={{ color: 'var(--text-secondary)' }} title="Core module, always on">
                    Locked
                  </span>
                ) : (
                  <button
                    className="btn"
                    disabled={busy === m.id}
                    onClick={() => void toggle(m)}
                  >
                    {busy === m.id ? '...' : m.enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
