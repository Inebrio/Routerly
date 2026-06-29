import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getEndUsers, type EndUser } from '../../api';

export function ProjectEndUsersTab() {
  const { id: projectId } = useParams<{ id: string }>();
  const [users, setUsers] = useState<EndUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    getEndUsers(projectId)
      .then(data => setUsers(data))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div style={{ padding: '24px 0', maxWidth: 1100 }}>
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : err ? (
        <div className="form-error">{err}</div>
      ) : !users || users.length === 0 ? (
        <div className="empty-state">
          <p>No end-user activity recorded yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>First Seen</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.userId}>
                  <td><span className="mono" style={{ fontSize: '0.85rem' }}>{u.userId}</span></td>
                  <td>{u.requests}</td>
                  <td>{u.totalTokens.toLocaleString()}</td>
                  <td className="mono" style={{ fontSize: '0.85rem' }}>${u.totalCost.toFixed(4)}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {new Date(u.firstSeen).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {new Date(u.lastSeen).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
