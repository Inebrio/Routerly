import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getNotificationInbox, markNotificationsRead, type InboxItem } from '../api';

const POLL_MS = 60_000;

export function severityIcon(sev: InboxItem['severity']) {
  if (sev === 'critical') return <AlertCircle size={15} style={{ color: 'var(--danger)' }} />;
  if (sev === 'warning') return <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />;
  return <Info size={15} style={{ color: 'var(--text-muted)' }} />;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Compact popup showing latest 5 notifications, anchored to the profile row. */
export function NotificationDropdown({
  anchorRef,
  open,
  onClose,
  items,
  unread,
  onMarkAll,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  items: InboxItem[];
  unread: number;
  onMarkAll: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const maxH = 360;
    // ponytail: open upward when near bottom of viewport
    const spaceBelow = window.innerHeight - r.top;
    const top = spaceBelow >= maxH ? r.top : Math.max(8, r.bottom - maxH);
    setStyle({
      position: 'fixed',
      left: r.right + 8,
      top,
      width: 320,
      maxHeight: maxH,
      overflowY: 'auto',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-lg)',
      zIndex: 9999,
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(t) &&
          anchorRef.current && !anchorRef.current.contains(t)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const preview = items.slice(0, 5);

  return createPortal(
    <div ref={dropdownRef} style={style}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
        fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)',
      }}>
        <span>Notifications</span>
        {unread > 0 && (
          <button
            onClick={onMarkAll}
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

      {/* Items */}
      {preview.length === 0 ? (
        <div style={{ padding: '18px 12px', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          No notifications
        </div>
      ) : (
        preview.map(n => (
          <Link
            key={n.id}
            to={`/dashboard/profile/notifications?notification=${n.id}`}
            onClick={onClose}
            style={{
              display: 'flex', gap: 8, padding: '10px 12px',
              borderBottom: '1px solid var(--border)',
              background: n.read ? 'transparent' : 'var(--bg-card)',
              textDecoration: 'none', color: 'inherit',
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
          </Link>
        ))
      )}

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <Link
          to="/dashboard/profile/notifications"
          onClick={onClose}
          style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}
        >
          View all notifications
        </Link>
      </div>
    </div>,
    document.body
  );
}

/** Profile-row inline badge + dropdown. Manages its own polling. */
export function ProfileNotificationBadge({ anchorRef }: { anchorRef: React.RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  // In-app inbox is opt-in: stay hidden until the service reports a dashboard channel.
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getNotificationInbox({ limit: 50 });
      setItems(res.items);
      setUnread(res.unreadCount);
      setEnabled(res.enabled);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    void load();
    // Keep polling so the bell appears if a dashboard channel is added later.
    const id = setInterval(() => { void load(); }, POLL_MS);
    // Refetch immediately when a notification is emitted (e.g. a channel test) or the tab regains focus.
    const refresh = () => { void load(); };
    window.addEventListener('routerly:notifications', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('routerly:notifications', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  // Refetch when opening the dropdown so the preview is current.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function markAll() {
    try {
      await markNotificationsRead({ all: true });
      setItems(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* non-critical */ }
  }

  if (!enabled) return null;

  return (
    <>
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        title="Notifications"
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
          color: 'var(--text-muted)', flexShrink: 0,
        }}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: 'var(--danger)', color: '#fff',
            borderRadius: 999, fontSize: '0.6rem', fontWeight: 700,
            minWidth: 14, height: 14, lineHeight: '14px', textAlign: 'center',
            padding: '0 2px',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      <NotificationDropdown
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        unread={unread}
        onMarkAll={markAll}
      />
    </>
  );
}
