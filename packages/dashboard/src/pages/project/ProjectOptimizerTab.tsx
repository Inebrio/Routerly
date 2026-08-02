import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ShieldOff } from 'lucide-react';
import type { Message } from '@routerly/shared';
import { optimizerLabel } from '@routerly/shared';
import {
  updateProject,
  getInstalledOptimizers,
  getProfiles,
  assignProjectProfiles,
  previewOptimizers,
  getOptimizerSamples,
  type InstalledOptimizer,
  type OptimizerProfile,
  type OptimizerPreviewResult,
  type TrafficSample,
} from '../../api';
import { useProject } from './ProjectLayout';
import { useAuth } from '../../AuthContext';
import { SearchableSelect } from '../../components/SearchableSelect';
import { timeAgo } from '../../components/NotificationBell';
import { TextDiff, promptText } from '../../components/TextDiff';
import {
  OptimizerStepsEditor,
  buildOptimizerSteps,
  mergeOptimizerRows,
  type OptimizerRow,
} from '../../components/OptimizerStepsEditor';

export function ProjectOptimizerTab() {
  const { project, setProject } = useProject();
  const { can } = useAuth();
  const canRead = can('optimizers:read');
  const canManage = can('optimizers:manage');

  const [installed, setInstalled] = useState<InstalledOptimizer[]>([]);
  const [rows, setRows] = useState<OptimizerRow[]>([]);
  const [profiles, setProfiles] = useState<OptimizerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  // Preview panel state
  const [sample, setSample] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState('');
  const [preview, setPreview] = useState<OptimizerPreviewResult | null>(null);
  // Real prompts this project sent, offered as an alternative to typing one.
  const [samples, setSamples] = useState<TrafficSample[]>([]);
  const [pickedSample, setPickedSample] = useState('');
  // The prompt the last preview actually ran on, so step 1 has something to diff against.
  const [previewInput, setPreviewInput] = useState<Message[]>([]);
  const [openStep, setOpenStep] = useState<number | null>(null);

  // Steps to install on the next project refresh, used when switching from a
  // profile to custom so the profile steps become the editable starting point.
  const pendingRows = React.useRef<OptimizerRow[] | null>(null);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    getInstalledOptimizers()
      .then(setInstalled)
      .catch(() => setInstalled([]))
      .finally(() => setLoading(false));
    getProfiles('optimizer')
      .then(list => setProfiles(list.filter((p): p is OptimizerProfile => p.kind === 'optimizer')))
      .catch(() => setProfiles([]));
  }, [canRead]);

  useEffect(() => {
    if (!canRead || !project) return;
    getOptimizerSamples(project.id).then(setSamples).catch(() => setSamples([]));
  }, [canRead, project?.id]);

  // Merge the project's configured steps (in order) with any installed
  // optimizer not yet configured (appended, disabled).
  useEffect(() => {
    /* v8 ignore next */
    if (!project) return;
    if (pendingRows.current) {
      setRows(pendingRows.current);
      pendingRows.current = null;
      return;
    }
    setRows(mergeOptimizerRows(project.optimizers?.steps ?? [], installed));
  }, [project, installed]);

  async function onAssignProfile(profileId: string) {
    /* v8 ignore next */
    if (!project) return;
    setErr('');
    try {
      const updated = await assignProjectProfiles(project.id, { optimizer: profileId === '' ? null : profileId });
      setProject(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign optimizer profile');
    }
  }

  async function doSave() {
    /* v8 ignore next */
    if (!project) return;
    setErr('');
    setSaving(true);
    try {
      const payload: Parameters<typeof updateProject>[1] = {
        name: project.name,
        models: project.models,
        optimizers: { steps: buildOptimizerSteps(rows) },
      };
      const updated = await updateProject(project.id, payload);
      setProject(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error saving optimizers');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSave();
  }

  // A prompt captured from real traffic, when one is picked; otherwise the text typed below.
  const chosenSample = pickedSample === '' ? undefined : samples[Number(pickedSample)];
  const previewMessages: Message[] = chosenSample
    ? chosenSample.messages
    : [{ role: 'user', content: sample }];

  async function runPreview() {
    /* v8 ignore next */
    if (!project) return;
    setPreviewErr('');
    setPreview(null);
    setOpenStep(null);
    setPreviewing(true);
    try {
      const result = await previewOptimizers({
        projectId: project.id,
        sampleMessages: previewMessages,
        steps: buildOptimizerSteps(rows),
      });
      setPreviewInput(previewMessages);
      setPreview(result);
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : 'Error running preview');
    } finally {
      setPreviewing(false);
    }
  }

  if (!canRead) {
    return (
      <div className="empty-state" style={{ maxWidth: 800 }}>
        <ShieldOff size={40} />
        <p>You don't have permission to view optimizers.</p>
      </div>
    );
  }

  if (loading) return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }} className="loading-center">
      <div className="spinner" />
    </div>
  );

  const savedDelta = preview ? preview.estimatedTokensBefore - preview.estimatedTokensAfter : 0;

  const assignedProfileId = project?.optimizerProfileId ?? '';
  const profileAssigned = assignedProfileId !== '';
  const defaultProfileId = profiles.find(p => p.builtin)?.id ?? profiles[0]?.id ?? '';
  const assignedProfile = profiles.find(p => p.id === assignedProfileId);

  async function onSelectMode(next: 'profile' | 'custom') {
    if ((next === 'profile') === profileAssigned) return;
    if (next === 'profile') {
      if (!defaultProfileId) {
        setErr('No optimizer profile available. Create one from the Profiles page.');
        return;
      }
      await onAssignProfile(defaultProfileId);
      return;
    }
    // Leaving a profile: its steps become the editable starting point.
    if (assignedProfile) pendingRows.current = mergeOptimizerRows(assignedProfile.optimizers.steps, installed);
    await onAssignProfile('');
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="form-group">
        <label className="form-label">Optimizers</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Optimizers reduce prompt tokens before requests reach the provider. They run in order from top to bottom.
          Use a shared optimizer profile, or define this project's own pipeline.
        </p>

        {canManage && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className={`btn btn-sm ${profileAssigned ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => void onSelectMode('profile')}
            >
              Profile
            </button>
            <button
              type="button"
              className={`btn btn-sm ${profileAssigned ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => void onSelectMode('custom')}
            >
              Custom
            </button>
          </div>
        )}

        {profileAssigned ? (
          <>
            <SearchableSelect
              style={{ maxWidth: 420 }}
              ariaLabel="Optimizer Profile"
              value={assignedProfileId}
              onChange={v => void onAssignProfile(v)}
              disabled={!canManage}
              options={[
                ...profiles.filter(p => p.builtin).map(p => ({ value: p.id, label: `${p.label} (built-in)` })),
                ...profiles.filter(p => !p.builtin).map(p => ({ value: p.id, label: p.label })),
              ]}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
              Steps come from the profile and follow its changes. Edit them on the Profiles page, or switch to Custom to start from a copy of them.
            </p>
            {assignedProfile && assignedProfile.optimizers.steps.length > 0 && (
              <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {assignedProfile.optimizers.steps.map(s => (
                  <li key={s.id}>
                    {optimizerLabel(s.id)}
                    {s.enabled ? '' : ' (disabled)'}
                    {s.threshold != null ? `, threshold ${s.threshold}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Drag to reorder, toggle to enable. Some optimizers use a threshold to control how aggressively they trim.
            </p>
            <OptimizerStepsEditor rows={rows} setRows={setRows} disabled={!canManage} />
          </>
        )}
      </div>

      {canManage && !profileAssigned && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void doSave()}>
            {saving ? 'Saving...' : 'Save Optimizers'}
          </button>
          {saved && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--success, #22c55e)', fontSize: '0.85rem' }}>
              <Check size={16} /> Saved
            </span>
          )}
        </div>
      )}

      <div style={{ margin: '28px 0 20px', borderTop: '1px solid var(--border)' }} />

      {/* Preview token savings */}
      <div className="form-group">
        <span className="form-label">Preview token savings</span>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Run the current (unsaved) pipeline over a prompt to see what each step removes and what it costs.
          Replay one of this project's own recent prompts, or type one.
        </p>

        <div style={{ marginBottom: 12 }}>
          <span className="form-label" style={{ fontSize: '0.75rem' }}>Prompt</span>
          <SearchableSelect
            style={{ maxWidth: 420 }}
            ariaLabel="Prompt to preview"
            value={pickedSample}
            onChange={v => { setPickedSample(v); setPreview(null); }}
            options={[
              { value: '', label: 'Type a prompt below' },
              ...samples.map((s, i) => ({
                value: String(i),
                label: `${timeAgo(s.capturedAt)} · ${s.estimatedTokens.toLocaleString()} tokens · ${s.messages.length} message${s.messages.length === 1 ? '' : 's'}`,
              })),
            ]}
          />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
            {samples.length === 0
              ? 'No recent prompts captured yet. The service keeps the last few prompts of each project in memory, after PII scrubbing and until it restarts.'
              : 'Captured after PII scrubbing, kept in memory only. Long prompts are stored as an excerpt.'}
          </p>
        </div>

        {chosenSample ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface-active)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Replaying {chosenSample.messages.length} message{chosenSample.messages.length === 1 ? '' : 's'} from {timeAgo(chosenSample.capturedAt)}
              {chosenSample.truncated ? ' (excerpt)' : ''}
            </div>
            <pre style={{
              margin: 0, maxHeight: 200, overflow: 'auto', fontSize: '0.76rem', lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)',
            }}>
              {promptText(chosenSample.messages)}
            </pre>
          </div>
        ) : (
          <textarea
            id="optimizer-sample"
            aria-label="Sample prompt"
            className="form-input"
            rows={4}
            placeholder="Paste a sample user message..."
            value={sample}
            onChange={e => setSample(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
          />
        )}
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={previewing || (!chosenSample && sample.trim() === '')}
            onClick={() => void runPreview()}
          >
            {previewing ? 'Running...' : 'Run Preview'}
          </button>
        </div>

        {previewErr && <div className="form-error" style={{ marginTop: 12 }}>{previewErr}</div>}

        {preview && (
          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 24, padding: '12px 16px', background: 'var(--surface-active)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Before</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{preview.estimatedTokensBefore}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>After</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{preview.estimatedTokensAfter}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Saved</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: savedDelta > 0 ? 'var(--success, #22c55e)' : 'var(--text-primary)' }}>
                  {savedDelta} {preview.estimatedTokensBefore > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({Math.round((savedDelta / preview.estimatedTokensBefore) * 100)}%)</span>}
                </div>
              </div>
            </div>
            {preview.perStep.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)' }}>Optimizer</th>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)', textAlign: 'right' }}>Before</th>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)', textAlign: 'right' }}>After</th>
                    <th style={{ padding: '8px 16px', fontWeight: 500, borderTop: '1px solid var(--border)', textAlign: 'right' }}>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.perStep.map((s, i) => {
                    const open = openStep === i;
                    const previous = i === 0 ? previewInput : preview.perStep[i - 1]!.messages;
                    return (
                      <React.Fragment key={`${s.id}-${i}`}>
                        <tr style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setOpenStep(open ? null : i)}>
                          <td style={{ padding: '8px 16px' }}>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setOpenStep(open ? null : i); }}
                              aria-expanded={open}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                                padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left',
                              }}
                            >
                              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {optimizerLabel(s.id)}
                            </button>
                            {s.rolledBack && (
                              <div style={{ fontSize: '0.68rem', color: 'var(--warning)', marginTop: 2, paddingLeft: 20 }}>
                                rolled back: the change was rejected as unsafe
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{s.before}</td>
                          <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{s.after}</td>
                          <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace', color: s.before - s.after > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{s.before - s.after}</td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={4} style={{ padding: '0 16px 12px' }}>
                              <TextDiff
                                before={promptText(previous)}
                                after={promptText(s.messages)}
                                emptyLabel={s.rolledBack
                                  ? 'The change this step produced was rolled back, so the prompt reached the next step untouched.'
                                  : 'This step left the prompt unchanged.'}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
