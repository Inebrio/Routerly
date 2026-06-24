import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck } from 'lucide-react';
import { getNotificationInbox, markNotificationsRead, type InboxItem } from '../api';

const POLL_MS = 60_000;

function severityIcon(sev: InboxItem['severity']) {
  if (sev === 'critical') return <AlertCircle size={15} style={{ color: 'var(--danger)' }} />;
  if (sev === 'warning') return <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />;
  return <Info size={15} style={{ color: 'var(--text-muted)' }} />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await getNotificationInbox({ limit: 50 });
      setItems(res.items);
      setUnread(res.unreadCount);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markOne(id: string) {
    try {
      await markNotificationsRead({ ids: [id] });
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnread(u => Math.max(0, u - 1));
    } catch { /* non-critical */ }
  }

  async function markAll() {
    try {
      await markNotificationsRead({ all: true });
      setItems(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* non-critical */ }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="nav-item"
        title={collapsed ? 'Notifications' : undefined}
        onClick={() => setOpen(o => !o)}
        style={{ position: 'relative', width: '100%' }}
      >
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Bell size={15} />
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: -6, right: -8,
              background: 'var(--danger)', color: '#fff',
              borderRadius: 999, fontSize: '0.62rem', fontWeight: 700,
              minWidth: 15, height: 15, lineHeight: '15px', textAlign: 'center',
              padding: '0 3px',
            }}>{unread > 99 ? '99+' : unread}</span>
          )}
        </span>
        <span className="nav-label">Notifications</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
          width: 320, maxHeight: 420, overflowY: 'auto',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 1000,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)',
          }}>
            <span>Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                title="Mark all as read"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--accent)', fontSize: '0.72rem',
                }}
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '18px 12px', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              No notifications
            </div>
          ) : (
            items.map(n => (
              <button
                key={n.id}
                onClick={() => !n.read && markOne(n.id)}
                style={{
                  display: 'flex', gap: 8, width: '100%', textAlign: 'left',
                  padding: '10px 12px', border: 'none', cursor: n.read ? 'default' : 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: n.read ? 'transparent' : 'var(--bg-card)',
                }}
              >
                <span style={{ marginTop: 1 }}>{severityIcon(n.severity)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: n.read ? 400 : 600, color: 'var(--text-primary)' }}>
                    {n.event}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {timeAgo(n.timestamp)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
