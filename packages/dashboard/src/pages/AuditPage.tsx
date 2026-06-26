import React, { useEffect, useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getAuditLog } from '../api';
import type { AuditEntry } from '../api';
import { DateRangePicker, type DateRange } from '../components/DateRangePicker';
import { useFilterState } from '../hooks/useFilterState';

const PAGE_SIZE = 50;

const RESULT_COLOR: Record<AuditEntry['result'], string> = {
  success:   'var(--success, #22c55e)',
  forbidden: 'var(--warning, #f59e0b)',
  error:     'var(--error, #ef4444)',
};

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

export function AuditPage() {
  const [entries, setEntries]     = useState<AuditEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [pagination, setPagination] = useState({ page: 1, totalRecords: 0, totalPages: 1 });
  const [page, setPage]           = useState(1);

  const [emailFilter, setEmail]   = useFilterState<string>({ key: 'audit-filter-email', defaultValue: '' });
  const [actionFilter, setAction] = useFilterState<string>({ key: 'audit-filter-action', defaultValue: '' });
  const [resultFilter, setResult] = useFilterState<'all' | AuditEntry['result']>({ key: 'audit-filter-result', defaultValue: 'all' });
  const [dateRange, setDateRange] = useFilterState<DateRange>({ key: 'audit-filter-dateRange', defaultValue: { from: '', to: '', label: 'All time' } });

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const resp = await getAuditLog({
        ...(emailFilter ? { userId: emailFilter } : {}),
        ...(actionFilter ? { action: actionFilter } : {}),
        ...(resultFilter !== 'all' ? { result: resultFilter } : {}),
        ...(dateRange.from ? { from: dateRange.from } : {}),
        ...(dateRange.to ? { to: dateRange.to } : {}),
        page: p,
        pageSize: PAGE_SIZE,
      });
      setEntries(resp.entries);
      setPagination(resp.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailFilter, actionFilter, dateRange, resultFilter]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [emailFilter, actionFilter, dateRange, resultFilter]);

  useEffect(() => { void load(page); }, [load, page]);

  function handleSearch() { setPage(1); void load(1); }

  return (
    <>
      {/* Filter bar */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Period</FilterLabel>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 180 }}>
            <FilterLabel>User</FilterLabel>
            <input
              className="form-input"
              placeholder="Email or user ID"
              value={emailFilter}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 180 }}>
            <FilterLabel>Action</FilterLabel>
            <input
              className="form-input"
              placeholder="e.g. model:create"
              value={actionFilter}
              onChange={e => setAction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Result</FilterLabel>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'success', 'forbidden', 'error'] as const).map(r => (
                <button
                  key={r}
                  className={`btn btn-sm ${resultFilter === r ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setResult(r)}
                >
                  {r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>&nbsp;</FilterLabel>
            <button className="btn btn-sm btn-secondary" onClick={() => handleSearch()} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>
          No audit entries found.
        </div>
      ) : (
        <>
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
                      <span style={{ color: RESULT_COLOR[e.result], fontWeight: 600 }}>{e.result}</span>
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.details ? JSON.stringify(e.details) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, padding: '10px 0' }}>
            <button
              className="btn btn-sm btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ← Previous
            </button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Page {pagination.page} of {pagination.totalPages}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                ({pagination.totalRecords} total)
              </span>
            </span>
            <button
              className="btn btn-sm btn-secondary"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </>
  );
}
