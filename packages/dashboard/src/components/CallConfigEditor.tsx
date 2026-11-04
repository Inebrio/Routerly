import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CALL_SETTINGS, CALL_TIERS, CALL_MAX_OUTPUT_TOKENS_MIN, CALL_MAX_OUTPUT_TOKENS_MAX, CALL_DEFAULT_THRESHOLDS,
  type CallClientPolicy, type CallConfig, type CallLevel, type CallSettingId, type CallSettings, type CallSettingSkip, type CallTier,
} from '@routerly/shared';
import { SearchableSelect } from './SearchableSelect';

const LEVELS: CallLevel[] = ['low', 'medium', 'high'];

/** Validation message key for a config the server would reject, or null. Parents use it to block save. */
export function callConfigError(v: CallConfig | undefined): string | null {
  if (!v) return null;
  for (const tier of CALL_TIERS) {
    const m = v.tiers[tier]?.maxOutputTokens;
    if (m !== undefined && (!Number.isInteger(m) || m < CALL_MAX_OUTPUT_TOKENS_MIN || m > CALL_MAX_OUTPUT_TOKENS_MAX)) return 'callConfig.invalidMax';
  }
  const med = v.thresholds?.mediumFromTokens ?? CALL_DEFAULT_THRESHOLDS.mediumFromTokens;
  const high = v.thresholds?.highFromTokens ?? CALL_DEFAULT_THRESHOLDS.highFromTokens;
  if (!Number.isInteger(med) || !Number.isInteger(high) || med < 1 || high < 1 || med >= high) return 'callConfig.invalidThresholds';
  return null;
}

/** One line "effort high · max 4096 · verbosity low", shared by the trace and the usage record page. */
export function CallSettingsText({ settings }: { settings: CallSettings }) {
  const { t } = useTranslation();
  const parts = [
    settings.effort && `${t('callConfig.setting.effort')} ${settings.effort}`,
    settings.maxOutputTokens !== undefined && `${t('callConfig.setting.maxOutputTokens')} ${settings.maxOutputTokens}`,
    settings.verbosity && `${t('callConfig.setting.verbosity')} ${settings.verbosity}`,
  ].filter(Boolean);
  return <span>{parts.length ? parts.join(' · ') : t('callConfig.trace.none')}</span>;
}

/** Skipped settings with the reason, e.g. "effort: unsupported". Renders nothing when empty. */
export function CallSkippedText({ skipped }: { skipped?: CallSettingSkip[] | undefined }) {
  const { t } = useTranslation();
  if (!skipped || skipped.length === 0) return null;
  return (
    <span style={{ color: 'var(--text-muted)' }}>
      {t('callConfig.trace.skipped')}: {skipped.map(s => `${t(`callConfig.setting.${s.setting}`)} (${t(`callConfig.reason.${s.reason}`)})`).join(', ')}
    </span>
  );
}

const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: '110px repeat(3, minmax(0, 1fr))', gap: 8, alignItems: 'center' };
const HEAD: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' };
const ROW_LABEL: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' };

interface Props {
  /** undefined until the operator touches the editor. */
  value: CallConfig | undefined;
  onChange: (v: CallConfig) => void;
  readOnly?: boolean;
  /** 'profile' shows the "from profile" label (config comes from the bound profile). */
  source?: 'router' | 'profile';
}

export function CallConfigEditor({ value, onChange, readOnly = false, source = 'router' }: Props) {
  const { t } = useTranslation();
  const cfg: CallConfig = value ?? { enabled: false, tiers: {} };
  const clientPolicy = (s: CallSettingId): CallClientPolicy => cfg.clientValues?.[s] ?? 'keep';
  const errKey = callConfigError(value);
  const off = !cfg.enabled;

  function setTier(tier: CallTier, key: keyof CallSettings, v: string) {
    const next: CallSettings = { ...(cfg.tiers[tier] ?? {}) };
    if (v === '') delete next[key];
    else if (key === 'maxOutputTokens') next.maxOutputTokens = Number(v);
    else next[key] = v as CallLevel;
    onChange({ ...cfg, tiers: { ...cfg.tiers, [tier]: next } });
  }
  function setPolicy(s: CallSettingId, p: CallClientPolicy) {
    onChange({ ...cfg, clientValues: { ...cfg.clientValues, [s]: p } });
  }
  function setThreshold(key: 'mediumFromTokens' | 'highFromTokens', v: string) {
    const next = { ...cfg.thresholds };
    if (v === '') delete next[key]; else next[key] = Number(v);
    onChange({ ...cfg, thresholds: next });
  }

  const levelSelect = (tier: CallTier, key: 'effort' | 'verbosity') => (
    <SearchableSelect
      ariaLabel={`${t(`callConfig.tier.${tier}`)} ${t(`callConfig.setting.${key}`)}`}
      value={cfg.tiers[tier]?.[key] ?? ''}
      disabled={readOnly || off}
      onChange={v => setTier(tier, key, v)}
      options={[{ value: '', label: t('callConfig.unset') }, ...LEVELS.map(l => ({ value: l, label: t(`callConfig.tier.${l}`) }))]}
    />
  );

  return (
    <div className="form-group" data-testid="call-config-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <label className="form-label" style={{ margin: 0 }}>{t('callConfig.title')}</label>
        {readOnly && source === 'profile' && <span className="badge badge-neutral">{t('callConfig.fromProfile')}</span>}
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
        {t(readOnly && source === 'profile' ? 'callConfig.fromProfileHint' : 'callConfig.hint')}
      </p>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: readOnly ? 'default' : 'pointer', marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={cfg.enabled}
          disabled={readOnly}
          onChange={e => onChange({ ...cfg, enabled: e.target.checked })}
          style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
        />
        {t('callConfig.enable')}
      </label>

      {off && (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '10px 14px', background: 'var(--surface-active)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          {t('callConfig.disabled')}
        </div>
      )}

      {!off && (
        <div style={{ background: 'var(--surface-active)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={GRID}>
            <span style={HEAD}>{t('callConfig.tierColumn')}</span>
            {CALL_SETTINGS.map(s => <span key={s} style={HEAD}>{t(`callConfig.setting.${s}`)}</span>)}
          </div>
          {CALL_TIERS.map(tier => (
            <div key={tier} style={GRID}>
              <span style={ROW_LABEL}>{t(`callConfig.tier.${tier}`)}</span>
              {levelSelect(tier, 'effort')}
              <input
                className="form-input"
                type="number"
                min={CALL_MAX_OUTPUT_TOKENS_MIN}
                max={CALL_MAX_OUTPUT_TOKENS_MAX}
                step={1}
                placeholder={t('callConfig.unset')}
                aria-label={`${t(`callConfig.tier.${tier}`)} ${t('callConfig.setting.maxOutputTokens')}`}
                value={cfg.tiers[tier]?.maxOutputTokens ?? ''}
                disabled={readOnly}
                onChange={e => setTier(tier, 'maxOutputTokens', e.target.value)}
              />
              {levelSelect(tier, 'verbosity')}
            </div>
          ))}

          <div style={{ ...GRID, marginTop: 4 }}>
            <span style={{ ...ROW_LABEL, fontWeight: 500, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('callConfig.clientPolicy')}</span>
            {CALL_SETTINGS.map(s => (
              <SearchableSelect
                key={s}
                ariaLabel={`${t('callConfig.clientPolicy')} ${t(`callConfig.setting.${s}`)}`}
                value={clientPolicy(s)}
                disabled={readOnly}
                onChange={v => setPolicy(s, v as CallClientPolicy)}
                options={[{ value: 'keep', label: t('callConfig.keep') }, { value: 'override', label: t('callConfig.override') }]}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 4 }}>
            {(['mediumFromTokens', 'highFromTokens'] as const).map(k => (
              <div key={k} style={{ width: 170 }}>
                <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>{t(`callConfig.${k}`)}</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  placeholder={String(CALL_DEFAULT_THRESHOLDS[k])}
                  value={cfg.thresholds?.[k] ?? ''}
                  disabled={readOnly}
                  onChange={e => setThreshold(k, e.target.value)}
                />
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>{t('callConfig.thresholdsHint')}</p>

          {errKey && <div className="form-error" role="alert">{t(errKey, { min: CALL_MAX_OUTPUT_TOKENS_MIN, max: CALL_MAX_OUTPUT_TOKENS_MAX })}</div>}

          <div style={{ fontSize: '0.78rem', color: '#b45309', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.45 }}>
            {t('callConfig.hardCapWarning')}
          </div>
        </div>
      )}
    </div>
  );
}
