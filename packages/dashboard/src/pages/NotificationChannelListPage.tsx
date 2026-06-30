import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Bell, Pencil, Trash2, FlaskConical, X, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getNotificationChannels, deleteNotificationChannel, testNotificationChannel } from '../api';
import type { RedactedChannel } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  CHANNEL_PROVIDER_META,
  summariseChannel,
  providerLabel,
} from './notificationChannelFields';
import type { ChannelProvider } from './notificationChannelFields';

type SortKey = 'name' | 'type' | 'summary';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35, marginLeft: 4, flexShrink: 0 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />
    : <ChevronDown size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />;
}

type TestState = { loading: boolean; ok?: boolean; message?: string };

export function NotificationChannelListPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<RedactedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filtering
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Add channel picker dropdown
  const [addOpen, setAddOpen] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const addRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Delete confirm
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Per-row test status
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    getNotificationChannels()
      .then(setChannels)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  // Close picker when clicking outside
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false);
        setChannelSearch('');
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  useEffect(() => {
    if (addOpen) setTimeout(() => searchRef.current?.focus(), 0);
    else setChannelSearch('');
  }, [addOpen]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function handleDelete(id: string, name: string | undefined) {
    setConfirmState({
      message: `Remove channel "${name ?? id}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteNotificationChannel(id);
          setChannels(cs => cs.filter(c => c.id !== id));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to delete');
        }
      },
    });
  }

  async function handleTest(ch: RedactedChannel) {
    setTestStates(s => ({ ...s, [ch.id]: { loading: true } }));
    try {
      const res = await testNotificationChannel(ch.id, '');
      setTestStates(s => ({ ...s, [ch.id]: { loading: false, ok: res.ok, message: res.message } }));
      // A dashboard-channel test writes to the in-app inbox; refresh the bell now.
      if (res.ok) window.dispatchEvent(new Event('routerly:notifications'));
    } catch (e) {
      setTestStates(s => ({ ...s, [ch.id]: { loading: false, ok: false, message: e instanceof Error ? e.message : String(e) } }));
    }
  }

  // Provider options for filter
  const providerOptions = useMemo(
    () => Array.from(new Set(channels.map(c => c.provider))).sort(),
    [channels],
  );

  // Filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter(c => {
      if (providerFilter && c.provider !== providerFilter) return false;
      if (!q) return true;
      const name = (c.name ?? '').toLowerCase();
      const prov = providerLabel(c.provider as ChannelProvider).toLowerCase();
      return name.includes(q) || prov.includes(q);
    });
  }, [channels, search, providerFilter]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name ?? '').localeCompare(b.name ?? '');
          break;
        case 'type':
          cmp = providerLabel(a.provider as ChannelProvider).localeCompare(
            providerLabel(b.provider as ChannelProvider),
          );
          break;
        case 'summary':
          cmp = summariseChannel(a).localeCompare(summariseChannel(b));
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const thStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const thInner = (label: string, key: SortKey) => (
    <span style={{ display: 'inline-flex', alignItems: 'center' }} onClick={() => handleSort(key)}>
      {label}<SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
    </span>
  );

  const filteredToAdd = channelSearch.trim()
    ? CHANNEL_PROVIDER_META.filter(p =>
        p.label.toLowerCase().includes(channelSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(channelSearch.toLowerCase()))
    : CHANNEL_PROVIDER_META;

  return (
    <>
      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="toolbar">
        <span className="toolbar-title">
          {filtered.length !== channels.length
            ? `${filtered.length} of ${channels.length} channel${channels.length !== 1 ? 's' : ''}`
            : `${channels.length} channel${channels.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Provider filter */}
          {providerOptions.length > 1 && (
            <select
              value={providerFilter}
              onChange={e => setProviderFilter(e.target.value)}
              style={{
                height: 32, padding: '0 10px', fontSize: '0.85rem', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
                outline: 'none',
              }}
            >
              <option value="">All types</option>
              {providerOptions.map(p => (
                <option key={p} value={p}>{providerLabel(p as ChannelProvider)}</option>
              ))}
            </select>
          )}
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter channels…"
              style={{ paddingLeft: 28, paddingRight: search ? 28 : 10, height: 32, fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 200 }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                <X size={13} />
              </button>
            )}
          </div>
          {/* Add channel picker trigger */}
          <div ref={addRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setAddOpen(o => !o)}
            >
              <Plus size={16} /> Add Channel
            </button>
            {addOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: 280, zIndex: 100, overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <input ref={searchRef} type="text" value={channelSearch}
                    onChange={e => setChannelSearch(e.target.value)} placeholder="Search channels…"
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.85rem', color: 'var(--text-primary)' }} />
                </div>
                {filteredToAdd.length === 0
                  ? <div style={{ padding: '10px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No results</div>
                  : filteredToAdd.map((ch, i) => (
                      <button key={ch.key} type="button"
                        onClick={() => {
                          setAddOpen(false);
                          navigate(`/dashboard/settings/notifications/new?provider=${ch.key}`);
                        }}
                        style={{
                          display: 'flex', flexDirection: 'column', width: '100%',
                          padding: '10px 14px', background: 'none', border: 'none',
                          cursor: 'pointer', textAlign: 'left',
                          borderBottom: i < filteredToAdd.length - 1 ? '1px solid var(--border)' : 'none',
                        }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{ch.label}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ch.description}</span>
                      </button>
                    ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : channels.length === 0 ? (
        <div className="empty-state"><Bell size={40} /><p>No notification channels configured yet.</p></div>
      ) : sorted.length === 0 ? (
        <div className="empty-state"><Search size={40} /><p>No channels match the active filters.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={thStyle}>{thInner('Name', 'name')}</th>
                <th style={thStyle}>{thInner('Type', 'type')}</th>
                <th style={thStyle}>{thInner('Events / Targets', 'summary')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(ch => {
                const ts = testStates[ch.id];
                return (
                  <React.Fragment key={ch.id}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/dashboard/settings/notifications/${ch.id}`)}
                    >
                      <td>
                        {ch.name
                          ? <strong style={{ color: 'var(--text-primary)' }}>{ch.name}</strong>
                          : <strong style={{ color: 'var(--text-primary)' }}>{providerLabel(ch.provider as ChannelProvider)}</strong>}
                      </td>
                      <td>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {providerLabel(ch.provider as ChannelProvider)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {summariseChannel(ch)}
                        </span>
                      </td>
                      <td
                        style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          className="btn-icon"
                          onClick={() => handleTest(ch)}
                          title="Send test"
                          disabled={ts?.loading}
                        >
                          {ts?.loading
                            ? <div className="spinner" style={{ width: 12, height: 12 }} />
                            : <FlaskConical size={15} />}
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => navigate(`/dashboard/settings/notifications/${ch.id}`)}
                          title="Edit channel"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="btn-icon danger"
                          onClick={() => handleDelete(ch.id, ch.name)}
                          title="Delete channel"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                    {ts && !ts.loading && (
                      <tr>
                        <td colSpan={4} style={{ paddingTop: 0, paddingBottom: 6 }}>
                          <div style={{
                            fontSize: '0.78rem', padding: '4px 10px', borderRadius: 6,
                            background: ts.ok ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--danger) 12%, transparent)',
                            border: `1px solid ${ts.ok ? 'color-mix(in srgb, var(--success) 35%, transparent)' : 'color-mix(in srgb, var(--danger) 35%, transparent)'}`,
                            color: ts.ok ? 'var(--success)' : 'var(--danger)',
                          }}>
                            {ts.ok ? '✓ ' : '✕ '}{ts.message}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          confirmLabel="Delete"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}
