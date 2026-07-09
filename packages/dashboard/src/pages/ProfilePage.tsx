import React, { useState, useCallback, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import QRCode from 'qrcode';
import { User, Lock, ShieldCheck, ShieldOff, CheckCheck, Circle, RefreshCw, X, Trash2 } from 'lucide-react';
import { updateMe, setup2fa, confirm2fa, disable2fa, regenerateBackupCodes, getNotificationInbox, getNotificationInboxPage, markNotificationsRead, markNotificationsUnread, deleteNotifications, type InboxItem, type InboxPagination } from '../api';
import { useAuth } from '../AuthContext';
import { severityIcon, timeAgo } from '../components/NotificationBell';
import { useFilterState } from '../hooks/useFilterState';
import { DateRangePicker, type DateRange } from '../components/DateRangePicker';

// ─── Notifications tab ────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';

function severityLabel(sev: InboxItem['severity']): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

/** Absolute, locale-formatted timestamp (the inbox table shows full date, not "ago"). */
function fmtDate(ts: string): string {
  return new Date(ts).toLocaleString();
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}

/** Right-side panel showing one notification's full detail. */
function NotificationDetailDrawer({
  item,
  onClose,
  onMarkRead,
  onMarkUnread,
  onDelete,
}: {
  item: InboxItem;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const detailEntries = Object.entries(item.details ?? {});

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000 }}
      />
      <div
        role="dialog"
        aria-label="Notification detail"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, maxWidth: '90vw',
          background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)', zIndex: 1001, display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {severityIcon(item.severity)}
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Notification</span>
          </span>
          <button
            onClick={onClose}
            title="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <FilterLabel>Event</FilterLabel>
            <div style={{ marginTop: 4 }}>
              <code style={{ fontSize: '0.85rem', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, color: 'var(--text-primary)' }}>
                {item.event}
              </code>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 32 }}>
            <div>
              <FilterLabel>Severity</FilterLabel>
              <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                {severityIcon(item.severity)} {severityLabel(item.severity)}
              </div>
            </div>
            <div>
              <FilterLabel>Status</FilterLabel>
              <div style={{ marginTop: 4, fontSize: '0.85rem', color: item.read ? 'var(--text-muted)' : 'var(--accent)', fontWeight: item.read ? 400 : 600 }}>
                {item.read ? 'Read' : 'Unread'}
              </div>
            </div>
          </div>

          <div>
            <FilterLabel>Date</FilterLabel>
            <div style={{ marginTop: 4, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
              {fmtDate(item.timestamp)}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({timeAgo(item.timestamp)})</span>
            </div>
          </div>

          <div>
            <FilterLabel>Details</FilterLabel>
            {detailEntries.length === 0 ? (
              <div style={{ marginTop: 4, fontSize: '0.82rem', color: 'var(--text-muted)' }}>No additional details.</div>
            ) : (
              <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                {detailEntries.map(([k, v], i) => (
                  <div key={k} style={{
                    display: 'flex', gap: 10, padding: '7px 10px', fontSize: '0.8rem',
                    borderBottom: i < detailEntries.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 110, fontWeight: 500 }}>{k}</span>
                    <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {typeof v === 'string' ? v : JSON.stringify(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          {item.read ? (
            <button className="btn btn-secondary" onClick={() => onMarkUnread(item.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Circle size={14} /> Mark as unread
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => onMarkRead(item.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCheck size={14} /> Mark as read
            </button>
          )}
          <button className="btn btn-danger" onClick={() => onDelete(item.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </>
  );
}

export function ProfileNotificationsTab() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState<InboxPagination>({ page: 1, pageSize: PAGE_SIZE, totalRecords: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<InboxItem | null>(null);
  // Row selection for bulk operations (mark read / delete).
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const [severity, setSeverity] = useFilterState<SeverityFilter>({ key: 'notif-filter-severity', defaultValue: 'all' });
  const [eventFilter, setEventFilter] = useFilterState<string>({ key: 'notif-filter-event', defaultValue: '' });
  const [unreadOnly, setUnreadOnly] = useFilterState<boolean>({ key: 'notif-filter-unread', defaultValue: false });
  const [dateRange, setDateRange] = useFilterState<DateRange>({ key: 'notif-filter-dateRange', defaultValue: { from: '', to: '', label: 'All time' } });

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getNotificationInboxPage({
        page: p,
        pageSize: PAGE_SIZE,
        ...(severity !== 'all' ? { severity } : {}),
        ...(eventFilter.trim() ? { event: eventFilter.trim() } : {}),
        ...(unreadOnly ? { unreadOnly: true } : {}),
        ...(dateRange.from ? { from: dateRange.from } : {}),
        ...(dateRange.to ? { to: dateRange.to } : {}),
      });
      setItems(res.items);
      setUnreadCount(res.unreadCount);
      setPagination(res.pagination);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, [severity, eventFilter, unreadOnly, dateRange.from, dateRange.to]);

  // Reset to page 1 and clear selection when filters change.
  useEffect(() => { setPage(1); setCheckedIds(new Set()); }, [severity, eventFilter, unreadOnly, dateRange.from, dateRange.to]);
  useEffect(() => { void load(page); }, [load, page]);

  function toggleOne(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setCheckedIds(prev => prev.size === items.length ? new Set() : new Set(items.map(n => n.id)));
  }

  async function markOne(id: string) {
    try {
      await markNotificationsRead({ ids: [id] });
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(u => Math.max(0, u - 1));
      /* v8 ignore next */
      setSelected(s => s && s.id === id ? { ...s, read: true } : s);
      window.dispatchEvent(new Event('routerly:notifications'));
    } catch { /* non-critical */ }
  }

  async function markUnreadOne(id: string) {
    try {
      await markNotificationsUnread({ ids: [id] });
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: false } : n));
      setUnreadCount(u => u + 1);
      /* v8 ignore next */
      setSelected(s => s && s.id === id ? { ...s, read: false } : s);
      window.dispatchEvent(new Event('routerly:notifications'));
    } catch { /* non-critical */ }
  }

  async function markAll() {
    try {
      await markNotificationsRead({ all: true });
      setItems(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
      setSelected(s => s ? { ...s, read: true } : s);
      window.dispatchEvent(new Event('routerly:notifications'));
    } catch { /* non-critical */ }
  }

  async function bulkMarkRead() {
    const ids = [...checkedIds];
    /* v8 ignore next */
    if (ids.length === 0) return;
    try {
      await markNotificationsRead({ ids });
      const idSet = new Set(ids);
      const newlyRead = items.filter(n => idSet.has(n.id) && !n.read).length;
      setItems(prev => prev.map(n => idSet.has(n.id) ? { ...n, read: true } : n));
      setUnreadCount(u => Math.max(0, u - newlyRead));
      setCheckedIds(new Set());
      window.dispatchEvent(new Event('routerly:notifications'));
    } catch { /* non-critical */ }
  }

  async function bulkMarkUnread() {
    const ids = [...checkedIds];
    /* v8 ignore next */
    if (ids.length === 0) return;
    try {
      await markNotificationsUnread({ ids });
      const idSet = new Set(ids);
      const newlyUnread = items.filter(n => idSet.has(n.id) && n.read).length;
      setItems(prev => prev.map(n => idSet.has(n.id) ? { ...n, read: false } : n));
      setUnreadCount(u => u + newlyUnread);
      setCheckedIds(new Set());
      window.dispatchEvent(new Event('routerly:notifications'));
    } catch { /* non-critical */ }
  }

  async function removeIds(ids: string[]) {
    /* v8 ignore next */
    if (ids.length === 0) return;
    try {
      await deleteNotifications({ ids });
      const idSet = new Set(ids);
      const removedUnread = items.filter(n => idSet.has(n.id) && !n.read).length;
      setUnreadCount(u => Math.max(0, u - removedUnread));
      setCheckedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setSelected(s => s && idSet.has(s.id) ? null : s);
      window.dispatchEvent(new Event('routerly:notifications'));
      await load(page);
    } catch { /* non-critical */ }
  }

  function deleteOne(id: string) { void removeIds([id]); }
  function bulkDelete() { void removeIds([...checkedIds]); }

  return (
    <>
      {/* Filter bar */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Severity</FilterLabel>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'info', 'warning', 'critical'] as const).map(s => (
                <button
                  key={s}
                  className={`btn btn-sm ${severity === s ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSeverity(s)}
                >
                  {s === 'all' ? 'All' : severityLabel(s)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 200 }}>
            <FilterLabel>Event</FilterLabel>
            <input
              className="form-input"
              placeholder="e.g. provider.error"
              value={eventFilter}
              onChange={e => setEventFilter(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Period</FilterLabel>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>Status</FilterLabel>
            <button
              className={`btn btn-sm ${unreadOnly ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setUnreadOnly(!unreadOnly)}
            >
              {unreadOnly ? 'Unread only' : 'All'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <FilterLabel>&nbsp;</FilterLabel>
            <button className="btn btn-sm btn-secondary" onClick={() => void load(page)} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            <FilterLabel>{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</FilterLabel>
            {unreadCount > 0 && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={markAll}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {checkedIds.size > 0 && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{checkedIds.size} selected</span>
          <button className="btn btn-sm btn-secondary" onClick={bulkMarkRead} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CheckCheck size={14} /> Mark as read
          </button>
          <button className="btn btn-sm btn-secondary" onClick={bulkMarkUnread} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Circle size={14} /> Mark as unread
          </button>
          <button className="btn btn-sm btn-danger" onClick={bulkDelete} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={14} /> Delete
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setCheckedIds(new Set())} style={{ marginLeft: 'auto' }}>
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>
          No notifications found.
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '10px 12px', width: 40 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={items.length > 0 && checkedIds.size === items.length}
                        ref={el => { if (el) el.indeterminate = checkedIds.size > 0 && checkedIds.size < items.length; }}
                        onChange={toggleAll}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', verticalAlign: 'middle' }}
                      />
                    </th>
                    {['Severity', 'Event', 'Date', 'Status'].map(h => (
                      <th key={h} style={{
                        padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap',
                        fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((n, i) => (
                    <tr
                      key={n.id}
                      onClick={() => setSelected(n)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
                        background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)',
                      }}
                    >
                      <td style={{ padding: '9px 12px', borderLeft: `3px solid ${n.read ? 'transparent' : 'var(--accent)'}` }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${n.event}`}
                          checked={checkedIds.has(n.id)}
                          onChange={() => toggleOne(n.id)}
                          style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', verticalAlign: 'middle' }}
                        />
                      </td>
                      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {severityIcon(n.severity)} {severityLabel(n.severity)}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: n.read ? 400 : 600, color: 'var(--text-primary)' }}>{n.event}</td>
                      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDate(n.timestamp)}</td>
                      <td style={{ padding: '9px 12px' }}>
                        {n.read
                          ? <span style={{ color: 'var(--text-muted)' }}>Read</span>
                          : <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Unread</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, padding: '10px 0' }}>
            <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              ← Previous
            </button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Page {pagination.page} of {pagination.totalPages}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({pagination.totalRecords} total)</span>
            </span>
            <button className="btn btn-sm btn-secondary" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>
              Next →
            </button>
          </div>
        </>
      )}

      {selected && (
        <NotificationDetailDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onMarkRead={markOne}
          onMarkUnread={markUnreadOne}
          onDelete={deleteOne}
        />
      )}
    </>
  );
}

// ─── Profile (security) tab content ──────────────────────────────────────────

function ProfileSecurityTab() {
  const { user, updateUser } = useAuth();

  // ── Change password ─────────────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState('');

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSaved(false);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    setPwSaving(true);
    try {
      await updateMe({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 3000);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setPwSaving(false);
    }
  }

  // ── 2FA ─────────────────────────────────────────────────────────────────────
  type TwoFaStep = 'idle' | 'setup' | 'confirm' | 'enabled';
  const [tfaStep, setTfaStep] = useState<TwoFaStep>('idle');
  const [tfaSecret, setTfaSecret] = useState('');
  const [tfaQrUrl, setTfaQrUrl] = useState('');
  const [tfaBackupCodes, setTfaBackupCodes] = useState<string[]>([]);
  const [tfaCode, setTfaCode] = useState('');
  const [tfaError, setTfaError] = useState('');
  const [tfaBusy, setTfaBusy] = useState(false);
  const [tfaEnabled, setTfaEnabled] = useState(!!user?.totpEnabled);
  const [tfaQrImage, setTfaQrImage] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [backupVisible, setBackupVisible] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[]>([]);
  const [regenCode, setRegenCode] = useState('');

  useEffect(() => {
    if (!tfaQrUrl) { setTfaQrImage(''); return; }
    QRCode.toDataURL(tfaQrUrl, { width: 180, margin: 2 })
      .then(setTfaQrImage)
      .catch(() => setTfaQrImage(''));
  }, [tfaQrUrl]);

  async function handleSetup2fa() {
    setTfaError('');
    setTfaBusy(true);
    try {
      const res = await setup2fa();
      setTfaSecret(res.secret);
      setTfaQrUrl(res.qrUrl);
      setTfaBackupCodes(res.backupCodes);
      setTfaStep('setup');
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setTfaBusy(false);
    }
  }

  async function handleConfirm2fa(e: React.FormEvent) {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      await confirm2fa(tfaCode);
      setTfaCode('');
      setTfaStep('enabled');
      setTfaEnabled(true);
      updateUser({ totpEnabled: true });
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Confirmation failed');
    } finally {
      setTfaBusy(false);
    }
  }

  async function handleDisable2fa(e: React.FormEvent) {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      await disable2fa(disableCode);
      setDisableCode('');
      setTfaEnabled(false);
      setTfaStep('idle');
      updateUser({ totpEnabled: false });
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Disable failed');
    } finally {
      setTfaBusy(false);
    }
  }

  async function handleRegenerateBackupCodes(e: React.FormEvent) {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      const res = await regenerateBackupCodes(regenCode);
      setNewBackupCodes(res.backupCodes);
      setRegenCode('');
      setBackupVisible(false);
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Regeneration failed');
    } finally {
      setTfaBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 520 }}>

      {/* ── Account info (read-only) ─────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface-2, rgba(255,255,255,0.04))',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'linear-gradient(135deg, #3d75f5, #5a90f8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <User size={20} color="#fff" />
        </div>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            {user?.email}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Role: <span style={{ color: 'var(--text-secondary)' }}>{user?.role}</span>
          </div>
        </div>
      </div>

      {/* ── Change password ────────────────────────────────────────────────── */}
      <section>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 14 }}>
          Change Password
        </h3>
        <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="p-cur-pw">Current Password</label>
            <input
              id="p-cur-pw"
              type="password"
              className="form-input"
              value={pwForm.currentPassword}
              onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))}
              required
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="p-new-pw">New Password</label>
            <input
              id="p-new-pw"
              type="password"
              className="form-input"
              value={pwForm.newPassword}
              onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))}
              placeholder="Minimum 8 characters"
              required
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="p-conf-pw">Confirm New Password</label>
            <input
              id="p-conf-pw"
              type="password"
              className="form-input"
              value={pwForm.confirmPassword}
              onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))}
              required
            />
          </div>
          {pwError && <div className="form-error">{pwError}</div>}
          {pwSaved && <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.83rem', color: '#22c55e' }}>Password changed successfully.</div>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={pwSaving}>
              {pwSaving
                ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving...</>
                : <><Lock size={14} /> Change Password</>}
            </button>
          </div>
        </form>
      </section>

      {/* ── Two-Factor Authentication ──────────────────────────────────────── */}
      <section>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 14 }}>
          Two-Factor Authentication
        </h3>

        {tfaError && <div className="form-error" style={{ marginBottom: 12 }}>{tfaError}</div>}

        {tfaStep === 'idle' && !tfaEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              2FA is not enabled. Protect your account with a time-based one-time password.
            </p>
            <div>
              <button className="btn btn-primary" onClick={handleSetup2fa} disabled={tfaBusy}>
                <ShieldCheck size={14} /> Enable Two-Factor Authentication
              </button>
            </div>
          </div>
        )}

        {tfaStep === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code to confirm.
            </p>
            {tfaQrImage && (
              /* ponytail: white padding so QR scans in dark mode */
              <div style={{ alignSelf: 'flex-start', background: '#fff', padding: 8, borderRadius: 8, lineHeight: 0 }}>
                <img src={tfaQrImage} alt="2FA setup QR code" width={180} height={180} />
              </div>
            )}
            <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                Open your authenticator app (Google Authenticator, Authy, 1Password, etc.) and add a new account:
              </p>
              <ol style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Tap <strong>Add account</strong> or the <strong>+</strong> button</li>
                <li>Choose <strong>Enter setup key</strong> (or scan QR code if on mobile)</li>
                <li>Enter the secret shown below</li>
              </ol>
              {tfaQrUrl && (
                <a
                  href={tfaQrUrl}
                  style={{ display: 'block', marginTop: 10, fontSize: '0.72rem', color: 'var(--accent)', wordBreak: 'break-all' }}
                >
                  Tap here on mobile to open authenticator
                </a>
              )}
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                Manual entry secret:
              </p>
              <code style={{ fontSize: '0.8rem', background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4, letterSpacing: '0.1em' }}>
                {tfaSecret}
              </code>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                Save these backup codes. Each can be used once if you lose access to your authenticator.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
                {tfaBackupCodes.map(c => (
                  <code key={c} style={{ fontSize: '0.8rem', background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4 }}>{c}</code>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: '0.8rem' }}
                onClick={() => navigator.clipboard.writeText(tfaBackupCodes.join('\n'))}
              >
                Copy backup codes
              </button>
            </div>
            <form onSubmit={handleConfirm2fa} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="tfa-confirm-code">Enter code from your app to activate</label>
                <input
                  id="tfa-confirm-code"
                  type="text"
                  className="form-input"
                  value={tfaCode}
                  onChange={e => setTfaCode(e.target.value.trim())}
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={tfaBusy}>
                  {tfaBusy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Activate 2FA'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => { setTfaStep('idle'); setTfaError(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {(tfaStep === 'enabled' || tfaEnabled) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
            }}>
              <ShieldCheck size={16} color="#22c55e" />
              <span style={{ fontSize: '0.85rem', color: '#22c55e', fontWeight: 600 }}>2FA is enabled</span>
            </div>

            {newBackupCodes.length > 0 ? (
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>New backup codes (save these now):</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
                  {newBackupCodes.map(c => (
                    <code key={c} style={{ fontSize: '0.8rem', background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4 }}>{c}</code>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.8rem' }}
                  onClick={() => navigator.clipboard.writeText(newBackupCodes.join('\n'))}
                >
                  Copy
                </button>
              </div>
            ) : backupVisible ? (
              <form onSubmit={handleRegenerateBackupCodes} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="regen-code">Enter authenticator code to regenerate backup codes</label>
                  <input
                    id="regen-code"
                    type="text"
                    className="form-input"
                    value={regenCode}
                    onChange={e => setRegenCode(e.target.value.trim())}
                    placeholder="000000"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={tfaBusy}>
                    {tfaBusy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Regenerate'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setBackupVisible(false); setTfaError(''); }}>Cancel</button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setBackupVisible(true)}>
                Regenerate backup codes
              </button>
            )}

            <form onSubmit={handleDisable2fa} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="disable-code">Disable 2FA (enter authenticator code)</label>
                <input
                  id="disable-code"
                  type="text"
                  className="form-input"
                  value={disableCode}
                  onChange={e => setDisableCode(e.target.value.trim())}
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </div>
              <div>
                <button type="submit" className="btn" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }} disabled={tfaBusy}>
                  <ShieldOff size={14} /> Disable 2FA
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Tab bar (reuses ProjectLayout pattern) ───────────────────────────────────

const TABS = [
  { id: 'profile', label: 'Profile', to: '/dashboard/profile' },
  { id: 'notifications', label: 'Notifications', to: '/dashboard/profile/notifications' },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── ProfilePage ──────────────────────────────────────────────────────────────

export function ProfilePage({ initialTab = 'profile' }: { initialTab?: TabId }) {
  // In-app notifications are opt-in: the tab is shown only when the service
  // reports a `dashboard` channel exists. Undefined while loading.
  const [notifEnabled, setNotifEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    getNotificationInbox({ limit: 1 })
      .then(res => setNotifEnabled(res.enabled))
      .catch(() => setNotifEnabled(false));
  }, []);

  // Hide the notifications tab when disabled; fall back to the profile tab if the
  // route was hit directly (do not render the disabled notifications view).
  const tabs = notifEnabled ? TABS : TABS.filter(t => t.id !== 'notifications');
  const requestedTab = initialTab === 'notifications' && !notifEnabled ? 'profile' : initialTab;
  // Avoid a flash of the profile tab before the enabled flag resolves.
  const activeTab: TabId = initialTab === 'notifications' && notifEnabled === undefined
    ? 'notifications'
    : requestedTab;

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <div style={{ paddingBottom: 24 }}>
          <h1 style={{ margin: 0 }}>My Profile</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Manage your account settings
          </p>
        </div>

        {/* Tab navigation - same pattern as ProjectLayout */}
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)' }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <NavLink
                key={tab.id}
                to={tab.to}
                style={{
                  padding: '0 4px 12px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: '0.9rem', fontWeight: 500,
                  color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 32 }}>
        {activeTab === 'notifications' ? <ProfileNotificationsTab /> : <ProfileSecurityTab />}
      </div>
    </>
  );
}
