import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, Copy, Eye, Save, X, GripVertical, Route, ShieldOff, Play } from 'lucide-react';
import {
  getProfiles, cloneProfile, updateProfile, deleteProfile, simulateRouting, getProjects,
  type RoutingProfile, type RoutingPolicy, type SelectorType, type FallbackStrategyType, type Project,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { TraceEntryRenderer } from '../components/TraceEntryRenderer';
import { useAuth } from '../AuthContext';

// Duplicated (list mechanics only) from ProjectRoutingTab.tsx: no shared export exists for these.
const ALL_POLICY_TYPES = ['health', 'context', 'capability', 'budget-remaining', 'rate-limit', 'semantic-intent', 'llm', 'performance', 'fairness', 'cheapest', 'model-preference'] as const;

const POLICY_LABELS: Record<string, string> = {
  llm:               'AI Routing Policy',
  'rate-limit':      'Rate Limit Policy',
  'budget-remaining':'Budget Remaining Policy',
  'semantic-intent': 'Semantic Intent Policy',
  health:            'Health Policy',
  context:           'Context Policy',
  capability:        'Capability Policy',
  performance:       'Performance Policy',
  fairness:          'Fairness Policy',
  cheapest:          'Cheapest Policy',
  'model-preference':'Model Preference Policy',
};

const POLICY_DESCRIPTIONS: Record<string, string> = {
  context:          'Scores models based on available context window. Assigns 0 to models whose context window is smaller than the estimated request length, preventing truncation errors.',
  cheapest:         'Scores models inversely proportional to their token cost. The cheapest model gets 1.0, the most expensive gets 0.0, helping reduce API spend across requests.',
  health:           'Scores models based on their recent error rate using exponential decay (recent errors weigh more). Applies a circuit breaker that sets the score to 0 when the weighted error rate exceeds a critical threshold.',
  performance:      'Scores models based on their recent average latency using exponential decay. The fastest model gets 1.0, the slowest gets 0.0. Models without recent data default to 1.0.',
  llm:              'Uses an AI model to score candidates based on the semantic content of the request. Supports routing guidance prompts per model and considers budget headroom when limits are configured.',
  capability:       'Hard filter: assigns 0 to models that explicitly lack a feature required by the request (vision, function calling, JSON mode). Models without explicit capability declarations are not penalized.',
  'rate-limit':     'Penalizes models with a high recent call frequency to reduce the risk of hitting provider rate limits (HTTP 429). Supports a configurable hard threshold that forces the score to 0.',
  fairness:         'Distributes traffic evenly by penalizing models that received more successful calls recently. Acts as a soft round-robin to prevent load from concentrating on a single model.',
  'budget-remaining': 'Scores models based on remaining budget headroom across all configured limits. Prefers models with more room before their thresholds are hit, spreading consumption proactively.',
  'semantic-intent':  'Classifies the request by semantic intent using embeddings, then restricts the candidate pool to the models mapped to that intent. Confident matches hard-filter the pool; ambiguous matches merge top-2 pools; unknown requests pass all candidates through.',
  'model-preference': 'When the client requests a specific model (not routerly/ada), awards a configurable bonus score to that model. When no preference is expressed, the policy abstains. Position in the list controls how much the preference weighs against other policies.',
};

const SELECTOR_LABELS: Record<SelectorType, string> = {
  argmax:           'Highest Score (argmax)',
  'weighted-random':'Weighted Random',
  'round-robin':    'Round Robin',
  cheapest:         'Cheapest',
  'lowest-latency': 'Lowest Latency',
};

const FALLBACK_LABELS: Record<FallbackStrategyType, string> = {
  'next-best':           'Next Best Candidate',
  'retry-after-cooldown':'Retry After Cooldown',
  abort:                 'Abort',
};

const DEFAULT_SIM_REQUEST = '{"model": "auto", "messages": [{"role": "user", "content": "Hello"}]}';

type PolicyItem = RoutingPolicy & { internalId: string };

interface EditFormState {
  label: string;
  selector: SelectorType;
  fallbackStrategy: FallbackStrategyType;
  policies: PolicyItem[];
}

function mkId() { return Math.random().toString(36).substring(2, 9); }

function toEditForm(p: RoutingProfile): EditFormState {
  return {
    label: p.label,
    selector: p.selector,
    fallbackStrategy: p.fallbackStrategy,
    policies: p.policies.map(pol => ({ ...pol, internalId: mkId() })),
  };
}

export function ProfilesPage() {
  const { can } = useAuth();
  const canRead = can('profiles:read');
  const canManage = can('profiles:manage');

  const [profiles, setProfiles] = useState<RoutingProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showClone, setShowClone] = useState(false);
  const [cloneForm, setCloneForm] = useState<{ baseId: string; label: string }>({ baseId: '', label: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({});

  // Simulate panel
  const [simProjectId, setSimProjectId] = useState('');
  const [simProfileId, setSimProfileId] = useState('');
  const [simRequest, setSimRequest] = useState(DEFAULT_SIM_REQUEST);
  const [simError, setSimError] = useState('');
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<{ picked: string; ranked: { model: string; score: number; cost?: number }[]; trace: unknown[] } | null>(null);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [profs, projs] = await Promise.all([getProfiles(), getProjects()]);
      setProfiles(profs);
      setProjects(projs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }

  function openProfile(p: RoutingProfile) {
    setOpenId(p.id);
    setEditForm(toEditForm(p));
    setConfigErrors({});
    setShowClone(false);
  }

  function closeProfile() {
    setOpenId(null);
    setEditForm(null);
    setConfigErrors({});
  }

  async function submitClone() {
    setSaving(true);
    setError('');
    try {
      const created = await cloneProfile(cloneForm.baseId, cloneForm.label);
      setProfiles(ps => [...ps, created]);
      setShowClone(false);
      setCloneForm({ baseId: '', label: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clone profile');
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit() {
    /* v8 ignore next */
    if (!openId || !editForm) return;
    if (Object.values(configErrors).some(Boolean)) {
      setError('Fix invalid policy config before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await updateProfile(openId, {
        label: editForm.label,
        selector: editForm.selector,
        fallbackStrategy: editForm.fallbackStrategy,
        policies: editForm.policies.map(({ internalId, ...rest }) => rest),
      });
      setProfiles(ps => ps.map(p => p.id === updated.id ? updated : p));
      closeProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(p: RoutingProfile) {
    setConfirmState({
      message: `Delete profile "${p.label}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteProfile(p.id);
          setProfiles(ps => ps.filter(x => x.id !== p.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to delete profile');
        }
      },
    });
  }

  async function runSimulation() {
    setSimError('');
    setSimResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(simRequest);
    } catch {
      setSimError('Request body is not valid JSON.');
      return;
    }
    setSimRunning(true);
    try {
      const result = await simulateRouting({
        projectId: simProjectId,
        ...(simProfileId ? { profileId: simProfileId } : {}),
        request: parsed,
      });
      setSimResult(result);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setSimRunning(false);
    }
  }

  // --- Policy editor helpers (edit form) ---
  const [draggedPolicyIdx, setDraggedPolicyIdx] = useState<number | null>(null);

  function updatePolicies(fn: (prev: PolicyItem[]) => PolicyItem[]) {
    /* v8 ignore next: only called while the editor (and thus editForm) is open */
    setEditForm(f => f ? { ...f, policies: fn(f.policies) } : f);
  }

  function addPolicy(type: string) {
    updatePolicies(prev => [...prev, { internalId: mkId(), type: type as RoutingPolicy['type'], enabled: true }]);
  }

  function removePolicy(idx: number) {
    updatePolicies(prev => prev.filter((_, i) => i !== idx));
  }

  function togglePolicyEnabled(idx: number) {
    updatePolicies(prev => prev.map((p, i) => i === idx ? { ...p, enabled: !p.enabled } : p));
  }

  function onDragStartPolicy(e: React.DragEvent, idx: number) {
    setDraggedPolicyIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnterPolicy(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedPolicyIdx === null || draggedPolicyIdx === targetIdx) return;
    const from = draggedPolicyIdx;
    updatePolicies(prev => {
      const copy = [...prev];
      const dragged = copy[from]!;
      copy.splice(from, 1);
      copy.splice(targetIdx, 0, dragged);
      return copy;
    });
    setDraggedPolicyIdx(targetIdx);
  }
  function onDragEndPolicy() {
    setDraggedPolicyIdx(null);
  }

  function onConfigBlur(idx: number, internalId: string, raw: string) {
    if (raw.trim() === '') {
      updatePolicies(prev => prev.map((p, i) => i === idx ? { ...p, config: undefined } : p));
      setConfigErrors(errs => { const { [internalId]: _drop, ...rest } = errs; return rest; });
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      updatePolicies(prev => prev.map((p, i) => i === idx ? { ...p, config: parsed } : p));
      setConfigErrors(errs => { const { [internalId]: _drop, ...rest } = errs; return rest; });
    } catch {
      setConfigErrors(errs => ({ ...errs, [internalId]: 'Invalid JSON' }));
    }
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>Routing Profiles</h1>
          <p>Reusable routing policy sets, selectors, and fallback strategies</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view routing profiles.</p></div>
        </div>
      </>
    );
  }

  const builtinBases = profiles.filter(p => p.builtin);
  const openProfileRow = openId ? profiles.find(p => p.id === openId) : undefined;
  const openReadOnly = !!openProfileRow?.builtin || !canManage;

  return (
    <>
      <div className="page-header">
        <h1>Routing Profiles</h1>
        <p>Reusable routing policy sets, selectors, and fallback strategies</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
              </span>
              {canManage && !showClone && (
                <button className="btn btn-primary" onClick={() => { setShowClone(true); closeProfile(); }}>
                  <Plus size={16} /> Clone a Profile
                </button>
              )}
            </div>

            {showClone && (
              <div className="card" style={{ padding: 20, marginBottom: 12, border: '1px solid var(--primary)', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 240px', marginBottom: 0 }}>
                    <label className="form-label">Base profile (built-in)</label>
                    <SearchableSelect
                      options={builtinBases.map(p => ({ value: p.id, label: p.label }))}
                      value={cloneForm.baseId}
                      onChange={v => setCloneForm(f => ({ ...f, baseId: v }))}
                      placeholder="Select a built-in profile"
                    />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
                    <label className="form-label" htmlFor="clone-label">Label</label>
                    <input id="clone-label" className="form-input" placeholder="e.g. My Balanced Profile" value={cloneForm.label}
                      onChange={e => setCloneForm(f => ({ ...f, label: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" disabled={saving || !cloneForm.baseId || !cloneForm.label.trim()} onClick={() => void submitClone()}>
                    {saving ? <span className="spinner" /> : <><Save size={14} /> Clone</>}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setShowClone(false); setCloneForm({ baseId: '', label: '' }); }}>
                    <X size={14} /> Cancel
                  </button>
                </div>
              </div>
            )}

            {profiles.length === 0 ? (
              <div className="empty-state"><Route size={40} /><p>No routing profiles yet.</p></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Type</th>
                      <th>Selector</th>
                      <th>Fallback</th>
                      <th>Version</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map(p => (
                      <React.Fragment key={p.id}>
                        <tr>
                          <td>{p.label}</td>
                          <td><span className={`badge badge-${p.builtin ? 'success' : 'custom'}`}>{p.builtin ? 'Built-in' : 'Custom'}</span></td>
                          <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{SELECTOR_LABELS[p.selector]}</span></td>
                          <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{FALLBACK_LABELS[p.fallbackStrategy]}</span></td>
                          <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.version}</span></td>
                          <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {p.builtin ? (
                              <button className="btn-icon" onClick={() => openProfile(p)} title="View">
                                <Eye size={15} />
                              </button>
                            ) : canManage && (
                              <>
                                <button className="btn-icon" onClick={() => openProfile(p)} title="Edit">
                                  <Edit2 size={15} />
                                </button>
                                <button className="btn-icon danger" onClick={() => handleDelete(p)} title="Delete">
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                            {canManage && (
                              <button className="btn-icon" onClick={() => { setShowClone(true); closeProfile(); setCloneForm({ baseId: p.builtin ? p.id : '', label: '' }); }} title="Clone">
                                <Copy size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {openId === p.id && editForm && (
                          <tr>
                            <td colSpan={6} style={{ padding: 0 }}>
                              <ProfileEditor
                                form={editForm}
                                setForm={setEditForm as React.Dispatch<React.SetStateAction<EditFormState>>}
                                readOnly={openReadOnly}
                                saving={saving}
                                configErrors={configErrors}
                                onSave={submitEdit}
                                onCancel={closeProfile}
                                onAddPolicy={addPolicy}
                                onRemovePolicy={removePolicy}
                                onToggleEnabled={togglePolicyEnabled}
                                onConfigBlur={onConfigBlur}
                                dragHandlers={{ onDragStartPolicy, onDragEnterPolicy, onDragEndPolicy }}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Simulate panel */}
            <div className="card" style={{ padding: 20, marginTop: 24, borderRadius: 8, border: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>Simulate Routing</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
                Preview which model a request would pick. No upstream call is made and no usage is recorded.
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
                  <label className="form-label">Project</label>
                  <SearchableSelect
                    options={projects.map(pr => ({ value: pr.id, label: pr.name }))}
                    value={simProjectId}
                    onChange={setSimProjectId}
                    placeholder="Select a project"
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
                  <label className="form-label">Profile (optional, leave blank to use the project's assigned profile)</label>
                  <SearchableSelect
                    options={profiles.map(pr => ({ value: pr.id, label: pr.label }))}
                    value={simProfileId}
                    onChange={setSimProfileId}
                    placeholder="Project's assigned profile"
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label" htmlFor="sim-request">Request body (JSON)</label>
                <textarea id="sim-request" className="form-input" rows={4} style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                  value={simRequest} onChange={e => setSimRequest(e.target.value)} />
              </div>
              {simError && <div className="form-error" style={{ marginBottom: 12 }}>{simError}</div>}
              <button className="btn btn-primary" disabled={simRunning || !simProjectId} onClick={() => void runSimulation()}>
                {simRunning ? <span className="spinner" /> : <><Play size={14} /> Run Simulation</>}
              </button>

              {simResult && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ marginBottom: 12, fontSize: '0.9rem' }}>
                    Picked model: <strong style={{ color: 'var(--primary)' }}>{simResult.picked}</strong>
                  </div>
                  {simResult.ranked.length > 0 && (
                    <div className="table-wrap" style={{ marginBottom: 16 }}>
                      <table>
                        <thead><tr><th>Model</th><th>Score</th><th>Cost</th></tr></thead>
                        <tbody>
                          {simResult.ranked.map((r, i) => (
                            <tr key={i}>
                              <td>{r.model}</td>
                              <td><span className="mono" style={{ fontSize: '0.78rem' }}>{r.score.toFixed(3)}</span></td>
                              <td><span className="mono" style={{ fontSize: '0.78rem' }}>{r.cost != null ? r.cost : '—'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {simResult.trace.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {simResult.trace.map((e, i) => <TraceEntryRenderer key={i} entry={e} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}

interface ProfileEditorProps {
  form: EditFormState;
  setForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  readOnly: boolean;
  saving: boolean;
  configErrors: Record<string, string>;
  onSave: () => void;
  onCancel: () => void;
  onAddPolicy: (type: string) => void;
  onRemovePolicy: (idx: number) => void;
  onToggleEnabled: (idx: number) => void;
  onConfigBlur: (idx: number, internalId: string, raw: string) => void;
  dragHandlers: {
    onDragStartPolicy: (e: React.DragEvent, idx: number) => void;
    onDragEnterPolicy: (e: React.DragEvent, idx: number) => void;
    onDragEndPolicy: () => void;
  };
}

function ProfileEditor({
  form, setForm, readOnly, saving, configErrors,
  onSave, onCancel, onAddPolicy, onRemovePolicy, onToggleEnabled, onConfigBlur, dragHandlers,
}: ProfileEditorProps) {
  return (
    <div className="card" style={{ padding: 20, border: '1px solid var(--primary)', borderRadius: 8, ...(readOnly ? { opacity: 0.85 } : {}) }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="edit-label">Label</label>
          <input id="edit-label" className="form-input" value={form.label} disabled={readOnly}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="edit-selector">Selector</label>
          <SearchableSelect
            options={(Object.keys(SELECTOR_LABELS) as SelectorType[]).map(s => ({ value: s, label: SELECTOR_LABELS[s] }))}
            value={form.selector}
            disabled={readOnly}
            placeholder="Selector"
            onChange={v => setForm(f => ({ ...f, selector: v as SelectorType }))}
          />
        </div>
        <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="edit-fallback">Fallback strategy</label>
          <SearchableSelect
            options={(Object.keys(FALLBACK_LABELS) as FallbackStrategyType[]).map(s => ({ value: s, label: FALLBACK_LABELS[s] }))}
            value={form.fallbackStrategy}
            disabled={readOnly}
            placeholder="Fallback strategy"
            onChange={v => setForm(f => ({ ...f, fallbackStrategy: v as FallbackStrategyType }))}
          />
        </div>
      </div>

      <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Policies</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {form.policies.map((policy, idx) => (
          <div
            key={policy.internalId}
            draggable={!readOnly}
            onDragStart={e => dragHandlers.onDragStartPolicy(e, idx)}
            onDragEnter={e => dragHandlers.onDragEnterPolicy(e, idx)}
            onDragEnd={dragHandlers.onDragEndPolicy}
            /* v8 ignore next */
            onDragOver={e => e.preventDefault()}
            style={{ background: 'var(--surface-active)', padding: 12, borderRadius: 8, border: '1px solid var(--border)', cursor: readOnly ? 'default' : 'grab' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ color: 'var(--text-muted)' }}><GripVertical size={16} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{POLICY_LABELS[policy.type] ?? policy.type}</div>
                {POLICY_DESCRIPTIONS[policy.type] && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                    {POLICY_DESCRIPTIONS[policy.type]}
                  </div>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: readOnly ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={policy.enabled} disabled={readOnly} onChange={() => onToggleEnabled(idx)} />
                Enabled
              </label>
              {!readOnly && (
                <button type="button" className="btn-icon danger" onClick={() => onRemovePolicy(idx)} title="Remove policy">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {policy.config != null && (
              <div style={{ marginTop: 10 }}>
                {/* ponytail: policy config edited as raw JSON in Profiles v1, matching CLI's
                    own v1 scope (clone+PATCH, no interactive editor). Port ProjectRoutingTab's
                    per-type config forms here when a project needs richer profile-level editing. */}
                <textarea
                  className="form-input"
                  rows={4}
                  disabled={readOnly}
                  defaultValue={JSON.stringify(policy.config, null, 2)}
                  onBlur={e => onConfigBlur(idx, policy.internalId, e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                />
                {configErrors[policy.internalId] && (
                  <div className="form-error" style={{ marginTop: 4 }}>{configErrors[policy.internalId]}</div>
                )}
              </div>
            )}
          </div>
        ))}
        {form.policies.length === 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            No policies in this profile.
          </div>
        )}
      </div>

      {!readOnly && (
        <div style={{ marginTop: 10, border: '1.5px dashed var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <SearchableSelect
            options={ALL_POLICY_TYPES
              .filter(t => !form.policies.some(p => p.type === t))
              /* v8 ignore start: ALL_POLICY_TYPES is always a subset of POLICY_LABELS/POLICY_DESCRIPTIONS keys */
              .map(t => ({ value: t, label: POLICY_LABELS[t] ?? t, ...(POLICY_DESCRIPTIONS[t] ? { description: POLICY_DESCRIPTIONS[t] } : {}) }))
              /* v8 ignore stop */}
            value=""
            onChange={onAddPolicy}
            placeholder="Add a policy..."
            disabled={ALL_POLICY_TYPES.every(t => form.policies.some(p => p.type === t))}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {!readOnly && (
          <button className="btn btn-primary" disabled={saving || !form.label.trim()} onClick={onSave}>
            {saving ? <span className="spinner" /> : <><Save size={14} /> Save</>}
          </button>
        )}
        <button className="btn btn-secondary" onClick={onCancel}>
          <X size={14} /> {readOnly ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
