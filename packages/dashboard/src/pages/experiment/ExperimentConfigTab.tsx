import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Copy, Check } from 'lucide-react';
import {
  createExperiment, updateExperiment, getRouters, getModels,
  type CreateExperimentBody, type ExperimentRotation, type ExperimentStickyKey,
  type ExperimentVariant, type Model, type Router,
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
  routerId: string;
  name: string;
  weight: string;
}

function toRow(v: ExperimentVariant): VariantRow {
  return { ...(v.id ? { id: v.id } : {}), routerId: v.routerId, name: v.name ?? '', weight: v.weight !== undefined ? String(v.weight) : '' };
}

const EMPTY_ROW: VariantRow = { routerId: '', name: '', weight: '' };

export function ExperimentConfigTab() {
  const { t } = useTranslation();
  const { experiment, setExperiment } = useExperiment();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can('experiments:manage');
  const isNew = !experiment;

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

  const [routers, setRouters] = useState<Router[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  // Creation result kept locally: the raw token comes back once, and the Done
  // link needs the new id before the layout has reloaded the experiment.
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([getRouters(), getModels()])
      .then(([ps, ms]) => { setRouters(ps); setModels(ms); })
      .catch(e => setErr(e instanceof Error ? e.message : t('experiments.config.errors.loadRoutersFailed')));
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
        .filter(v => v.routerId)
        .map(v => ({
          ...(v.id ? { id: v.id } : {}),
          routerId: v.routerId,
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
        setExperiment(await updateExperiment(experiment.id, buildBody()));
        setSaved(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('experiments.config.errors.saveFailed'));
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
      setErr(t('experiments.config.errors.copyFailed'));
    }
  }

  if (created) {
    return (
      <div style={{ maxWidth: 620 }}>
        <div style={{ padding: 16, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, marginBottom: 24 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
            {t('experiments.config.created')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>{created.token}</div>
            <button className="btn btn-secondary" onClick={() => copyToken(created.token)} style={{ flexShrink: 0 }}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('experiments.config.copied') : t('experiments.config.copy')}
            </button>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate(`/dashboard/experiments/${created.id}/config`)}>{t('experiments.config.done')}</button>
      </div>
    );
  }

  const shares = rotation === 'weighted'
    ? variantShares(variants.map(v => ({ id: '', routerId: v.routerId, ...(v.weight.trim() ? { weight: Number(v.weight) } : {}) })))
    : [];
  const routerOptions = routers.map(p => ({ value: p.id, label: p.name }));
  const readOnly = !canManage;

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}
      {saved && (
        <div style={{ marginBottom: 16, fontSize: '0.85rem', color: 'var(--success, #059669)' }}>{t('experiments.config.saved')}</div>
      )}

      <div className="form-section">
        <div className="form-group">
          <label className="form-label" htmlFor="exp-name">{t('experiments.config.fields.name')}</label>
          <input id="exp-name" className="form-input" value={name} disabled={readOnly}
            onChange={e => setName(e.target.value)} placeholder={t('experiments.config.fields.namePlaceholder')} required />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="exp-description">{t('experiments.config.fields.description')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('experiments.config.fields.optional')}</span></label>
          {/* A textarea: the list shows this in full, so it must be readable while typing it. */}
          <textarea id="exp-description" className="form-input" rows={2} value={description} disabled={readOnly}
            style={{ resize: 'vertical' }}
            onChange={e => setDescription(e.target.value)} placeholder={t('experiments.config.fields.descriptionPlaceholder')} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="exp-min-samples">{t('experiments.config.fields.minSamples')}</label>
          <input id="exp-min-samples" className="form-input" type="number" min={1} value={minSamples} disabled={readOnly}
            onChange={e => setMinSamples(e.target.value)} placeholder={String(DEFAULT_MIN_SAMPLES_PER_VARIANT)} />
          <p className="section-desc" style={{ margin: '8px 0 0' }}>
            {t('experiments.config.fields.minSamplesHint')}
          </p>
        </div>
      </div>

      <div className="form-section">
        <div className="section-title">{t('experiments.config.trafficSplit')}</div>
        <div className="form-group">
          <label className="form-label">{t('experiments.config.fields.rotation')}</label>
          <SearchableSelect
            ariaLabel={t('experiments.config.fields.rotation')}
            value={rotation}
            disabled={readOnly}
            onChange={v => setRotation(v as ExperimentRotation)}
            options={EXPERIMENT_ROTATIONS.map(r => ({
              value: r, label: ROTATION_CATALOG[r].label, description: ROTATION_CATALOG[r].description,
            }))}
          />
          <p className="section-desc" style={{ margin: '8px 0 0' }}>{ROTATION_CATALOG[rotation].description}</p>
        </div>

        {rotation === 'sticky' && (
          <div className="form-group">
            <label className="form-label">{t('experiments.config.fields.stickyOn')}</label>
            <SearchableSelect
              ariaLabel={t('experiments.config.fields.stickyKey')}
              value={stickyKey}
              disabled={readOnly}
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
        <div className="section-title">{t('experiments.config.variants.title')}</div>
        <p className="section-desc">
          {t('experiments.config.variants.desc')}
        </p>
        {variants.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ flex: 2 }}>
              <SearchableSelect
                ariaLabel={t('experiments.config.variants.routerAriaLabel', { index: i + 1 })}
                placeholder={t('experiments.config.variants.routerPlaceholder')}
                value={v.routerId}
                disabled={readOnly}
                onChange={val => setVariant(i, { routerId: val })}
                options={routerOptions}
              />
            </div>
            <input
              className="form-input" style={{ flex: 1 }} value={v.name} disabled={readOnly}
              aria-label={t('experiments.config.variants.labelAriaLabel', { index: i + 1 })} placeholder={t('experiments.config.variants.labelPlaceholder')}
              onChange={e => setVariant(i, { name: e.target.value })}
            />
            {rotation === 'weighted' && (
              <div style={{ width: 120 }}>
                <input
                  className="form-input" type="number" min={0} step="any" value={v.weight} disabled={readOnly}
                  aria-label={t('experiments.config.variants.weightAriaLabel', { index: i + 1 })} placeholder={t('experiments.config.variants.weightPlaceholder')}
                  onChange={e => setVariant(i, { weight: e.target.value })}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                  {shares[i] !== undefined ? `${Math.round(shares[i]! * 100)}%` : ''}
                </div>
              </div>
            )}
            {!readOnly && (
              <button type="button" className="btn-icon danger" title={t('experiments.config.variants.removeTitle', { index: i + 1 })}
                onClick={() => setVariants(rows => rows.filter((_, j) => j !== i))}>
                <X size={15} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="btn btn-secondary" onClick={() => setVariants(rows => [...rows, { ...EMPTY_ROW }])}>
            <Plus size={15} /> {t('experiments.config.variants.add')}
          </button>
        )}
      </div>

      <div className="form-section">
        <div className="section-title">{t('experiments.config.judge.title')}</div>
        <p className="section-desc">
          {t('experiments.config.judge.desc')}
        </p>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
            <input type="checkbox" checked={judgeEnabled} disabled={readOnly}
              onChange={e => setJudgeEnabled(e.target.checked)} />
            {t('experiments.config.judge.enable')}
          </label>
        </div>
        {judgeEnabled && (
          <>
            <div className="form-group">
              <label className="form-label">{t('experiments.config.judge.model')}</label>
              <SearchableSelect
                ariaLabel={t('experiments.config.judge.model')}
                placeholder={t('experiments.config.judge.modelPlaceholder')}
                value={judgeModelId}
                disabled={readOnly}
                onChange={setJudgeModelId}
                options={models.map(m => ({ value: m.id, label: m.name, description: m.provider }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="exp-criteria">{t('experiments.config.judge.criteria')}</label>
              <textarea id="exp-criteria" className="form-input" rows={4} value={judgeCriteria} disabled={readOnly}
                onChange={e => setJudgeCriteria(e.target.value)}
                placeholder={t('experiments.config.judge.criteriaPlaceholder')} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="exp-sample-rate">{t('experiments.config.judge.sampleRate')}</label>
              <input id="exp-sample-rate" className="form-input" type="number" min={0} max={100} value={judgeSampleRate}
                disabled={readOnly} onChange={e => setJudgeSampleRate(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 10, marginTop: 32 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !name.trim()}>
            {saving ? t('experiments.config.saving') : isNew ? t('experiments.config.create') : t('experiments.config.save')}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => navigate('/dashboard/experiments')}>{t('experiments.config.cancel')}</button>
        </div>
      )}
    </form>
  );
}
