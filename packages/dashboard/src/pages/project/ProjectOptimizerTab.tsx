import React, { useEffect, useState } from 'react';
import { Check, ShieldOff } from 'lucide-react';
import {
  updateProject,
  getInstalledOptimizers,
  getProfiles,
  assignProjectProfiles,
  previewOptimizers,
  type InstalledOptimizer,
  type OptimizerProfile,
  type OptimizerPreviewResult,
} from '../../api';
import { useProject } from './ProjectLayout';
import { useAuth } from '../../AuthContext';
import { SearchableSelect } from '../../components/SearchableSelect';
import {
  OptimizerStepsEditor,
  OPTIMIZER_LABELS,
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

  async function runPreview() {
    /* v8 ignore next */
    if (!project) return;
    setPreviewErr('');
    setPreview(null);
    setPreviewing(true);
    try {
      const result = await previewOptimizers({
        projectId: project.id,
        sampleMessages: [{ role: 'user', content: sample }],
        steps: buildOptimizerSteps(rows),
      });
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
                    {OPTIMIZER_LABELS[s.id] ?? s.id}
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
        <label className="form-label" htmlFor="optimizer-sample">Preview token savings</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Run the current (unsaved) pipeline over a sample user message to estimate token deltas per step.
        </p>
        <textarea
          id="optimizer-sample"
          className="form-input"
          rows={4}
          placeholder="Paste a sample user message..."
          value={sample}
          onChange={e => setSample(e.target.value)}
          style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={previewing || sample.trim() === ''}
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
                  {preview.perStep.map((s, i) => (
                    <tr key={`${s.id}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 16px' }}>{OPTIMIZER_LABELS[s.id] ?? s.id}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{s.before}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{s.after}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontFamily: 'monospace', color: s.before - s.after > 0 ? 'var(--success, #22c55e)' : 'var(--text-muted)' }}>{s.before - s.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
