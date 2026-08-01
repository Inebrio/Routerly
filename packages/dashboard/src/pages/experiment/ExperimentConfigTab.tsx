import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Copy, Check } from 'lucide-react';
import {
  createExperiment, updateExperiment, getProjects, getModels,
  type CreateExperimentBody, type ExperimentRotation, type ExperimentStickyKey,
  type ExperimentVariant, type Model, type Project,
} from '../../api';
import {
  EXPERIMENT_ROTATIONS, ROTATION_CATALOG, STICKY_KEYS, STICKY_KEY_CATALOG,
  DEFAULT_MIN_SAMPLES_PER_VARIANT, variantShares,
} from '@routerly/shared';
import { SearchableSelect } from '../../components/SearchableSelect';
import { writeToClipboard } from '../../utils/clipboard';
import { useAuth } from '../../AuthContext';
import { useExperiment } from './ExperimentLayout';

/** Local row: the weight stays a string so the field can be emptied while typing. */
interface VariantRow {
  id?: string;
  projectId: string;
  name: string;
  weight: string;
}

function toRow(v: ExperimentVariant): VariantRow {
  return { ...(v.id ? { id: v.id } : {}), projectId: v.projectId, name: v.name ?? '', weight: v.weight !== undefined ? String(v.weight) : '' };
}

const EMPTY_ROW: VariantRow = { projectId: '', name: '', weight: '' };

export function ExperimentConfigTab() {
  const { experiment, setExperiment } = useExperiment();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can('experiments:manage');
  const isNew = !experiment;
  // A running or closed test only takes name, description and sample size: everything
  // that would make the arms incomparable is frozen server-side too.
  const frozen = experiment !== null && experiment.status !== 'draft';

  const [name, setName] = useState(experiment?.name ?? '');
  const [description, setDescription] = useState(experiment?.description ?? '');
  const [rotation, setRotation] = useState<ExperimentRotation>(experiment?.rotation ?? 'sticky');
  const [stickyKey, setStickyKey] = useState<ExperimentStickyKey>(experiment?.stickyKey ?? 'auto');
  const [variants, setVariants] = useState<VariantRow[]>(
    experiment ? experiment.variants.map(toRow) : [{ ...EMPTY_ROW }, { ...EMPTY_ROW }],
  );
  const [minSamples, setMinSamples] = useState(
    experiment?.minSamplesPerVariant !== undefined ? String(experiment.minSamplesPerVariant) : '',
  );
  const [judgeEnabled, setJudgeEnabled] = useState(experiment?.judge?.enabled ?? false);
  const [judgeModelId, setJudgeModelId] = useState(experiment?.judge?.modelId ?? '');
  const [judgeCriteria, setJudgeCriteria] = useState((experiment?.judge?.criteria ?? []).join('\n'));
  const [judgeSampleRate, setJudgeSampleRate] = useState(
    experiment?.judge ? String(Math.round(experiment.judge.sampleRate * 100)) : '100',
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  // Creation result kept locally: the raw token comes back once, and the Done
  // link needs the new id before the layout has reloaded the experiment.
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([getProjects(), getModels()])
      .then(([ps, ms]) => { setProjects(ps); setModels(ms); })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load projects'));
  }, []);

  function setVariant(index: number, patch: Partial<VariantRow>) {
    setVariants(rows => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function buildBody(): CreateExperimentBody {
    const criteria = judgeCriteria.split('\n').map(c => c.trim()).filter(Boolean);
    const rate = Number(judgeSampleRate);
    return {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      rotation,
      ...(rotation === 'sticky' ? { stickyKey } : {}),
      variants: variants
        .filter(v => v.projectId)
        .map(v => ({
          ...(v.id ? { id: v.id } : {}),
          projectId: v.projectId,
          ...(v.name.trim() ? { name: v.name.trim() } : {}),
          ...(rotation === 'weighted' && v.weight.trim() ? { weight: Number(v.weight) } : {}),
        })),
      ...(judgeEnabled && judgeModelId
        ? { judge: { enabled: true, modelId: judgeModelId, criteria, sampleRate: Number.isFinite(rate) ? rate / 100 : 1 } }
        : {}),
      ...(minSamples.trim() ? { minSamplesPerVariant: Number(minSamples) } : {}),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSaved(false); setSaving(true);
    try {
      if (isNew) {
        const { token, ...masked } = await createExperiment(buildBody());
        setExperiment(masked);
        setCreated({ id: masked.id, token });
      } else {
        // Only the fields the service still accepts are sent once the test is live.
        const body = buildBody();
        const patch = frozen
          ? {
              name: body.name,
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.minSamplesPerVariant !== undefined ? { minSamplesPerVariant: body.minSamplesPerVariant } : {}),
            }
          : body;
        setExperiment(await updateExperiment(experiment.id, patch));
        setSaved(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save the experiment');
    } finally {
      setSaving(false);
    }
  }

  async function copyToken(token: string) {
    try {
      await writeToClipboard(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Copy failed: select and copy the token manually.');
    }
  }

  if (created) {
    return (
      <div style={{ maxWidth: 620 }}>
        <div style={{ padding: 16, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, marginBottom: 24 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
            Experiment created. Point your client at this token instead of a project token. It won't be shown again.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>{created.token}</div>
            <button className="btn btn-secondary" onClick={() => copyToken(created.token)} style={{ flexShrink: 0 }}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate(`/dashboard/experiments/${created.id}/config`)}>Done</button>
      </div>
    );
  }

  const shares = rotation === 'weighted'
    ? variantShares(variants.map(v => ({ id: '', projectId: v.projectId, ...(v.weight.trim() ? { weight: Number(v.weight) } : {}) })))
    : [];
  const projectOptions = projects.map(p => ({ value: p.id, label: p.name }));
  const readOnly = !canManage;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}
      {saved && (
        <div style={{ marginBottom: 16, fontSize: '0.85rem', color: 'var(--success, #059669)' }}>Saved.</div>
      )}
      {frozen && (
        <p className="section-desc" style={{ marginTop: 0 }}>
          This experiment is {experiment.status}. Only its name, description and sample size can still change: variants,
          rotation and judge are frozen so the arms stay comparable.
        </p>
      )}

      <div className="form-section">
        <div className="form-group">
          <label className="form-label" htmlFor="exp-name">Name</label>
          <input id="exp-name" className="form-input" value={name} disabled={readOnly}
            onChange={e => setName(e.target.value)} placeholder="Cheap vs premium routing" required />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="exp-description">Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input id="exp-description" className="form-input" value={description} disabled={readOnly}
            onChange={e => setDescription(e.target.value)} placeholder="What this test is trying to settle" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="exp-min-samples">Minimum calls per variant</label>
          <input id="exp-min-samples" className="form-input" type="number" min={1} value={minSamples} disabled={readOnly}
            onChange={e => setMinSamples(e.target.value)} placeholder={String(DEFAULT_MIN_SAMPLES_PER_VARIANT)} />
          <p className="section-desc" style={{ margin: '8px 0 0' }}>
            Below this, the Metrics tab marks the comparison as not yet conclusive.
          </p>
        </div>
      </div>

      <div className="form-section">
        <div className="section-title">Traffic split</div>
        <div className="form-group">
          <label className="form-label">Rotation</label>
          <SearchableSelect
            ariaLabel="Rotation"
            value={rotation}
            disabled={readOnly || frozen}
            onChange={v => setRotation(v as ExperimentRotation)}
            options={EXPERIMENT_ROTATIONS.map(r => ({
              value: r, label: ROTATION_CATALOG[r].label, description: ROTATION_CATALOG[r].description,
            }))}
          />
          <p className="section-desc" style={{ margin: '8px 0 0' }}>{ROTATION_CATALOG[rotation].description}</p>
        </div>

        {rotation === 'sticky' && (
          <div className="form-group">
            <label className="form-label">Sticky on</label>
            <SearchableSelect
              ariaLabel="Sticky key"
              value={stickyKey}
              disabled={readOnly || frozen}
              onChange={v => setStickyKey(v as ExperimentStickyKey)}
              options={STICKY_KEYS.map(k => ({
                value: k, label: STICKY_KEY_CATALOG[k].label, description: STICKY_KEY_CATALOG[k].description,
              }))}
            />
            <p className="section-desc" style={{ margin: '8px 0 0' }}>{STICKY_KEY_CATALOG[stickyKey].description}</p>
          </div>
        )}
      </div>

      <div className="form-section">
        <div className="section-title">Variants</div>
        <p className="section-desc">
          Each variant is an existing project, taken whole: its models, routing and guardrails all apply. A test needs at least two.
        </p>
        {variants.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ flex: 2 }}>
              <SearchableSelect
                ariaLabel={`Variant ${i + 1} project`}
                placeholder="Select a project"
                value={v.projectId}
                disabled={readOnly || frozen}
                onChange={val => setVariant(i, { projectId: val })}
                options={projectOptions}
              />
            </div>
            <input
              className="form-input" style={{ flex: 1 }} value={v.name} disabled={readOnly || frozen}
              aria-label={`Variant ${i + 1} label`} placeholder="Label (optional)"
              onChange={e => setVariant(i, { name: e.target.value })}
            />
            {rotation === 'weighted' && (
              <div style={{ width: 120 }}>
                <input
                  className="form-input" type="number" min={0} step="any" value={v.weight} disabled={readOnly || frozen}
                  aria-label={`Variant ${i + 1} weight`} placeholder="Weight"
                  onChange={e => setVariant(i, { weight: e.target.value })}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                  {shares[i] !== undefined ? `${Math.round(shares[i]! * 100)}%` : ''}
                </div>
              </div>
            )}
            {!readOnly && !frozen && (
              <button type="button" className="btn-icon danger" title={`Remove variant ${i + 1}`}
                onClick={() => setVariants(rows => rows.filter((_, j) => j !== i))}>
                <X size={15} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && !frozen && (
          <button type="button" className="btn btn-secondary" onClick={() => setVariants(rows => [...rows, { ...EMPTY_ROW }])}>
            <Plus size={15} /> Add variant
          </button>
        )}
      </div>

      <div className="form-section">
        <div className="section-title">Judge</div>
        <p className="section-desc">
          Optional: a model reads each sampled answer and scores it 0-10 against your criteria. Every judged call is an
          extra model call, billed like any other.
        </p>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
            <input type="checkbox" checked={judgeEnabled} disabled={readOnly || frozen}
              onChange={e => setJudgeEnabled(e.target.checked)} />
            Score answers with a judge model
          </label>
        </div>
        {judgeEnabled && (
          <>
            <div className="form-group">
              <label className="form-label">Judge model</label>
              <SearchableSelect
                ariaLabel="Judge model"
                placeholder="Select a model"
                value={judgeModelId}
                disabled={readOnly || frozen}
                onChange={setJudgeModelId}
                options={models.map(m => ({ value: m.id, label: m.name, description: m.provider }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="exp-criteria">Criteria</label>
              <textarea id="exp-criteria" className="form-input" rows={4} value={judgeCriteria} disabled={readOnly || frozen}
                onChange={e => setJudgeCriteria(e.target.value)}
                placeholder={'One per line, e.g.\nAnswers the question asked\nStays factual\nKeeps to the requested format'} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="exp-sample-rate">Share of calls judged (%)</label>
              <input id="exp-sample-rate" className="form-input" type="number" min={0} max={100} value={judgeSampleRate}
                disabled={readOnly || frozen} onChange={e => setJudgeSampleRate(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 10, marginTop: 32 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : isNew ? 'Create Experiment' : 'Save Changes'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => navigate('/dashboard/experiments')}>Cancel</button>
        </div>
      )}
    </form>
  );
}
