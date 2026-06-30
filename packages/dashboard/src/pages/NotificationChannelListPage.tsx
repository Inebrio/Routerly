import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Bell, Pencil, Trash2, FlaskConical, X, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getNotificationChannels, deleteNotificationChannel, testNotificationChannel, getSettings, updateSettings } from '../api';
import type { RedactedChannel } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MultiSelect } from '../components/MultiSelect';
import {
  CHANNEL_PROVIDER_META,
  summariseChannel,
  providerLabel,
} from './notificationChannelFields';
import type { ChannelProvider } from './notificationChannelFields';
import { NOTIFICATION_EVENTS } from '@routerly/shared';
import type { NotificationRule } from '@routerly/shared';

const EVENT_LABELS: Record<string, string> = {
  'provider.error':          'Provider – Error',
  'provider.degraded':       'Provider – Degraded',
  'provider.recovered':      'Provider – Recovered',
  'provider.rate_limited':   'Provider – Rate Limited',
  'routing.no_candidates':   'Routing – No Candidates',
  'routing.fallback_used':   'Routing – Fallback Used',
  'auth.login_failed':       'Auth – Login Failed',
  'auth.token_invalid':      'Auth – Token Invalid',
  'config.model_added':      'Config – Model Added',
  'config.model_deleted':    'Config – Model Deleted',
  'config.project_created':  'Config – Project Created',
  'config.project_deleted':  'Config – Project Deleted',
  'system.startup':          'System – Startup',
  'system.shutdown':         'System – Shutdown',
};
const EVENT_OPTIONS = NOTIFICATION_EVENTS.map(e => ({ value: e, label: EVENT_LABELS[e] ?? e }));

type SortKey = 'name' | 'type' | 'summary';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35, marginLeft: 4, flexShrink: 0 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />
    : <ChevronDown size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />;
}

type TestState = { loading: boolean; ok?: boolean; message?: string };

// Pill component for event/channel tags
function Pill({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: '0.75rem',
      background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
      color: 'var(--primary)',
      border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)',
      marginRight: 4,
      marginBottom: 2,
    }}>
      {label}
    </span>
  );
}

const DURATION_RE = /^\d+[smhd]$/;

export function NotificationChannelListPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<RedactedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Tab state
  const [activeTab, setActiveTab] = useState<'channels' | 'rules' | 'cooldowns'>('channels');

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

  // Routing rules + cooldowns
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [cooldowns, setCooldowns] = useState<Record<string, string>>({});
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesError, setRulesError] = useState('');

  const [newRuleEvents, setNewRuleEvents] = useState<string[]>([]);
  const [newRuleChannels, setNewRuleChannels] = useState<string[]>([]);
  const [addRuleOpen, setAddRuleOpen] = useState(false);

  const [newCooldownEvent, setNewCooldownEvent] = useState('');
  const [newCooldownDuration, setNewCooldownDuration] = useState('');
  const [addCooldownOpen, setAddCooldownOpen] = useState(false);
  const [cooldownDurationError, setCooldownDurationError] = useState('');

  useEffect(() => {
    load();
    getSettings().then(s => {
      setRules(s.notifications?.notificationRules ?? []);
      setCooldowns(s.notifications?.cooldowns ?? {});
    }).catch(() => {});
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

  async function saveRulesAndCooldowns(nextRules: NotificationRule[], nextCooldowns: Record<string, string>) {
    setRulesSaving(true); setRulesError('');
    try {
      const current = await getSettings();
      await updateSettings({ ...current, notifications: { ...(current.notifications ?? {}), notificationRules: nextRules, cooldowns: nextCooldowns } });
      setRulesSaved(true);
      setTimeout(() => setRulesSaved(false), 2000);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setRulesSaving(false);
    }
  }

  function handleAddRule() {
    if (!newRuleEvents.length || !newRuleChannels.length) return;
    const next = [...rules, { events: newRuleEvents, channels: newRuleChannels }];
    setRules(next);
    setNewRuleEvents([]); setNewRuleChannels([]); setAddRuleOpen(false);
    saveRulesAndCooldowns(next, cooldowns);
  }

  function handleRemoveRule(idx: number) {
    const next = rules.filter((_, i) => i !== idx);
    setRules(next);
    saveRulesAndCooldowns(next, cooldowns);
  }

  function handleAddCooldown() {
    if (!newCooldownEvent || !newCooldownDuration.trim()) return;
    if (!DURATION_RE.test(newCooldownDuration.trim())) {
      setCooldownDurationError('Invalid format. Use: 15m, 1h, 30s, 2d');
      return;
    }
    setCooldownDurationError('');
    const next = { ...cooldowns, [newCooldownEvent]: newCooldownDuration.trim() };
    setCooldowns(next);
    setNewCooldownEvent(''); setNewCooldownDuration(''); setAddCooldownOpen(false);
    saveRulesAndCooldowns(rules, next);
  }

  function handleRemoveCooldown(event: string) {
    const next = { ...cooldowns };
    delete next[event];
    setCooldowns(next);
    saveRulesAndCooldowns(rules, next);
  }

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

  // Shared save feedback banner (used in Rules + Cooldowns tabs)
  const saveBanner = (
    <>
      {rulesError && (
        <div className="form-error" style={{ marginBottom: 12 }}>{rulesError}</div>
      )}
      {rulesSaved && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--success)' }}>
          Saved
        </div>
      )}
      {rulesSaving && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ width: 12, height: 12 }} /> Saving…
        </div>
      )}
    </>
  );

  // Tab button style helper — matches ProjectLayout NavLink pattern
  function tabStyle(tab: 'channels' | 'rules' | 'cooldowns'): React.CSSProperties {
    const active = activeTab === tab;
    return {
      padding: '0 4px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: '0.9rem',
      fontWeight: 500,
      color: active ? 'var(--primary)' : 'var(--text-secondary)',
      borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
      background: 'none',
      border: 'none',
      borderBottomWidth: 2,
      borderBottomStyle: 'solid',
      borderBottomColor: active ? 'var(--primary)' : 'transparent',
      cursor: 'pointer',
      transition: 'all 0.2s',
      marginBottom: -1,
    };
  }

  return (
    <>
      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Tab navigation — same pattern as ProjectLayout */}
      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button style={tabStyle('channels')} onClick={() => setActiveTab('channels')}>Channels</button>
        <button style={tabStyle('rules')} onClick={() => setActiveTab('rules')}>Rules</button>
        <button style={tabStyle('cooldowns')} onClick={() => setActiveTab('cooldowns')}>Cooldowns</button>
      </div>

      {/* ── Tab: Channels ── */}
      {activeTab === 'channels' && (
        <>
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
        </>
      )}

      {/* ── Tab: Rules ── */}
      {activeTab === 'rules' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 20px' }}>
            Route specific event types to specific channels. First matching rule wins. Events not matching any rule go to all configured channels.
          </p>

          {saveBanner}

          {rules.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
              {rules.map((rule, idx) => (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '12px 14px',
                  borderBottom: idx < rules.length - 1 ? '1px solid var(--border)' : 'none',
                  background: 'var(--bg-elevated)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Events</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                      {rule.events.map(e => <Pill key={e} label={EVENT_LABELS[e] ?? e} />)}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Channels</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                      {rule.channels.map(cid => {
                        const ch = channels.find(c => c.id === cid);
                        return <Pill key={cid} label={ch ? (ch.name ?? ch.provider) : cid} />;
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={() => handleRemoveRule(idx)} title="Remove rule"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: 18 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {rules.length === 0 && !addRuleOpen && (
            <div className="empty-state" style={{ marginBottom: 16 }}>
              <Bell size={32} />
              <p>No routing rules. All events go to all configured channels.</p>
            </div>
          )}

          {addRuleOpen ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, background: 'var(--bg-elevated)', marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                <div>
                  <label className="form-label">Events</label>
                  <MultiSelect
                    options={EVENT_OPTIONS}
                    value={newRuleEvents}
                    onChange={setNewRuleEvents}
                    placeholder="Select events…"
                  />
                </div>
                <div>
                  <label className="form-label">Channels</label>
                  <MultiSelect
                    options={channels.map(c => ({ value: c.id, label: c.name ?? c.provider }))}
                    value={newRuleChannels}
                    onChange={setNewRuleChannels}
                    placeholder="Select channels…"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary"
                  disabled={!newRuleEvents.length || !newRuleChannels.length || rulesSaving}
                  onClick={handleAddRule} style={{ fontSize: '0.8rem' }}>
                  Add
                </button>
                <button type="button" className="btn btn-secondary"
                  onClick={() => { setAddRuleOpen(false); setNewRuleEvents([]); setNewRuleChannels([]); }}
                  style={{ fontSize: '0.8rem' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setAddRuleOpen(true)}>
              <Plus size={14} /> Add Rule
            </button>
          )}
        </div>
      )}

      {/* ── Tab: Cooldowns ── */}
      {activeTab === 'cooldowns' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 20px' }}>
            Set a minimum interval between repeated alerts for the same event. Suppressed events are still logged internally.
          </p>

          {saveBanner}

          {Object.keys(cooldowns).length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
              {Object.entries(cooldowns).map(([evt, dur], idx, arr) => (
                <div key={evt} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  background: 'var(--bg-elevated)',
                }}>
                  <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {EVENT_LABELS[evt] ?? evt}
                  </span>
                  <span style={{
                    padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontFamily: 'monospace',
                    background: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}>
                    {dur}
                  </span>
                  <button type="button" onClick={() => handleRemoveCooldown(evt)} title="Remove cooldown"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {Object.keys(cooldowns).length === 0 && !addCooldownOpen && (
            <div className="empty-state" style={{ marginBottom: 16 }}>
              <Bell size={32} />
              <p>No cooldowns configured. Repeated events fire without delay.</p>
            </div>
          )}

          {addCooldownOpen ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, background: 'var(--bg-elevated)', marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, marginBottom: 10 }}>
                <div>
                  <label className="form-label">Event</label>
                  <select className="form-input" value={newCooldownEvent} onChange={e => setNewCooldownEvent(e.target.value)}>
                    <option value="">Select event…</option>
                    {NOTIFICATION_EVENTS.map(e => (
                      <option key={e} value={e}>{EVENT_LABELS[e] ?? e}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Duration</label>
                  <input className="form-input" value={newCooldownDuration}
                    onChange={e => { setNewCooldownDuration(e.target.value); setCooldownDurationError(''); }}
                    placeholder="e.g. 15m, 1h, 30s, 2d" />
                  {cooldownDurationError && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginTop: 4 }}>{cooldownDurationError}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary"
                  disabled={!newCooldownEvent || !newCooldownDuration.trim() || rulesSaving}
                  onClick={handleAddCooldown} style={{ fontSize: '0.8rem' }}>
                  Add
                </button>
                <button type="button" className="btn btn-secondary"
                  onClick={() => { setAddCooldownOpen(false); setNewCooldownEvent(''); setNewCooldownDuration(''); setCooldownDurationError(''); }}
                  style={{ fontSize: '0.8rem' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setAddCooldownOpen(true)}>
              <Plus size={14} /> Add Cooldown
            </button>
          )}
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
