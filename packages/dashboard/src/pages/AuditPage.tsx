import React, { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { getAuditLog } from '../api';
import type { AuditEntry } from '../api';

const RESULT_COLORS: Record<AuditEntry['result'], string> = {
  success:   'var(--success, #22c55e)',
  forbidden: 'var(--warning, #f59e0b)',
  error:     'var(--error, #ef4444)',
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

export function AuditPage() {
  const [entries, setEntries]       = useState<AuditEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [emailFilter, setEmail]     = useState('');
  const [actionFilter, setAction]   = useState('');
  const [fromFilter, setFrom]       = useState('');
  const [toFilter, setTo]           = useState('');
  const [limit, setLimit]           = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAuditLog({
        ...(emailFilter ? { userId: emailFilter } : {}),
        ...(actionFilter ? { action: actionFilter } : {}),
        ...(fromFilter ? { from: fromFilter } : {}),
        ...(toFilter ? { to: toFilter } : {}),
        limit,
      });
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [emailFilter, actionFilter, fromFilter, toFilter, limit]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Audit Log</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Track administrative actions across Routerly.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <input
          className="form-input"
          placeholder="User email or ID"
          value={emailFilter}
          onChange={e => setEmail(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <input
          className="form-input"
          placeholder="Action (e.g. model:create)"
          value={actionFilter}
          onChange={e => setAction(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <input
          className="form-input"
          type="date"
          value={fromFilter}
          onChange={e => setFrom(e.target.value)}
          style={{ flex: '0 0 140px' }}
          title="From date"
        />
        <input
          className="form-input"
          type="date"
          value={toFilter}
          onChange={e => setTo(e.target.value)}
          style={{ flex: '0 0 140px' }}
          title="To date"
        />
        <select
          className="form-input"
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
          style={{ flex: '0 0 90px' }}
        >
          {[50, 100, 250, 500].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => void load()} disabled={loading}>
          <Search size={14} /> Search
        </button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No audit entries found.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                {['Timestamp', 'User', 'Action', 'Endpoint', 'Result', 'Details'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                  <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>{fmt(e.timestamp)}</td>
                  <td style={{ padding: '7px 12px' }}>{e.email || e.userId}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <code style={{ fontSize: '0.8rem', background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 3 }}>{e.action}</code>
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-secondary)' }}>{e.endpoint}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <span style={{ color: RESULT_COLORS[e.result], fontWeight: 600 }}>{e.result}</span>
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.details ? JSON.stringify(e.details) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            Showing {entries.length} entries (most recent first)
          </p>
        </div>
      )}
    </>
  );
}
