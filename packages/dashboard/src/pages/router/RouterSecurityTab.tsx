import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import {
  getProfiles,
  assignRouterProfiles,
  updateRouter,
  type GuardrailConfig,
  type GuardrailRule,
  type PiiConfig,
  type PiiPolicy,
  type SecurityProfile,
} from '../../api';
import { SearchableSelect } from '../../components/SearchableSelect';
import { PendingProfileNotice, StartFromProfile } from '../../components/ProfileDraftControls';
import { useProfileDraft } from '../../hooks/useProfileDraft';
import {
  SecurityRulesEditor,
  RULE_TYPE_LABELS,
  normalizeGuardActions,
  validateSecurityRules,
  type RuleWithId,
} from '../../components/SecurityRulesEditor';
import { useRouter } from './RouterLayout';
import { uuid } from '../../utils/uuid';

export function RouterSecurityTab() {
  const { t } = useTranslation();
  const { router, setRouter } = useRouter();

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [profiles, setProfiles] = useState<SecurityProfile[]>([]);

  // Guardrails state
  const [detectInjection, setDetectInjection] = useState(false);
  const [rules, setRules] = useState<RuleWithId[]>([]);

  // PII state
  const [piiPolicies, setPiiPolicies] = useState<PiiPolicy[]>([]);

  // Profile/custom choice, local until saved. The custom editor below always
  // shows what is stored, whichever mode is selected.
  const draft = useProfileDraft(router?.securityProfileId ?? '');

  useEffect(() => {
    getProfiles('security')
      .then(list => setProfiles(list.filter((p): p is SecurityProfile => p.kind === 'security')))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    if (!router) return;
    const g = router.guardrails;
    if (g) {
      setDetectInjection(g.detectInjection === true);
      setRules((g.rules ?? []).map(r => normalizeGuardActions({ ...r, _id: uuid() })));
    }
    const p = router.pii;
    if (p) {
      setPiiPolicies(p.policies ?? []);
    }
  }, [router]);

  const { regexErrorsByRule, moderationErrorIds } = validateSecurityRules(rules);
  const saveDisabled = saving || (draft.isCustom && (Object.keys(regexErrorsByRule).length > 0 || moderationErrorIds.size > 0));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!router || saveDisabled) return;
    setErr('');
    setSaving(true);
    try {
      const strippedRules: GuardrailRule[] = rules.map(({ _id: _dropped, ...rest }) => rest);
      const guardrailsPayload: GuardrailConfig = {
        ...(detectInjection ? { detectInjection } : {}),
        rules: strippedRules,
      };
      // Drop rows that would scrub nothing (empty entity set + no patterns), e.g. a freshly
      // added policy the user never configured. entities undefined = all entities = kept.
      const validPolicies = piiPolicies.filter(p => p.entities?.length !== 0 || (p.customPatterns?.length ?? 0) > 0);
      const piiPayload: PiiConfig = {
        policies: validPolicies,
      };
      let updated;
      if (draft.isCustom) {
        updated = await updateRouter(router.id, {
          name: router.name,
          models: router.models.map(m => ({ modelId: m.modelId, ...(m.prompt ? { prompt: m.prompt } : {}) })),
          guardrails: guardrailsPayload,
          pii: piiPayload,
        });
        if (draft.isPending) updated = await assignRouterProfiles(router.id, { security: null });
      } else {
        updated = await assignRouterProfiles(router.id, { security: draft.selected });
      }
      setRouter(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('routers.security.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!router) return null;

  const assignedProfileId = draft.selected;
  const profileAssigned = !draft.isCustom;
  const assignedProfile = profiles.find(p => p.id === assignedProfileId);
  const defaultProfileId = profiles.find(p => p.builtin)?.id ?? profiles[0]?.id ?? '';
  const profileOptions = [
    ...profiles.filter(p => p.builtin).map(p => ({ value: p.id, label: t('routers.security.profileSelect.builtinLabel', { label: p.label }) })),
    ...profiles.filter(p => !p.builtin).map(p => ({ value: p.id, label: p.label })),
  ];

  function onSelectMode(next: 'profile' | 'custom') {
    if ((next === 'profile') === profileAssigned) return;
    if (next === 'custom') { draft.selectCustom(); return; }
    if (!defaultProfileId) {
      setErr(t('routers.security.errors.noProfileAvailable'));
      return;
    }
    draft.selectProfile(defaultProfileId);
  }

  function copyProfile(id: string) {
    const p = profiles.find(x => x.id === id);
    if (!p) return;
    setRules((p.guardrails.rules ?? []).map(r => normalizeGuardActions({ ...r, _id: uuid() })));
    setPiiPolicies(p.pii.policies ?? []);
  }

  return (
    <form onSubmit={(e) => { void handleSave(e); }} style={{ maxWidth: 800 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}
      {draft.isPending && (
        <PendingProfileNotice profileLabel={draft.isCustom ? null : (assignedProfile?.label ?? assignedProfileId)} onDiscard={draft.discard} />
      )}

      <div className="form-group">
        <label className="form-label">{t('routers.security.title')}</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          {t('routers.security.description')}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={`btn btn-sm ${profileAssigned ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onSelectMode('profile')}
          >
            {t('routers.security.mode.profile')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${profileAssigned ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => onSelectMode('custom')}
          >
            {t('routers.security.mode.custom')}
          </button>
        </div>

        {profileAssigned && (
          <>
            <SearchableSelect
              style={{ maxWidth: 420 }}
              ariaLabel={t('routers.security.profileSelect.ariaLabel')}
              value={assignedProfileId}
              onChange={draft.selectProfile}
              options={profileOptions}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
              {t('routers.security.profileSelect.hint')}
            </p>
            {assignedProfile && (
              <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {(assignedProfile.guardrails.rules ?? []).map((r, i) => (
                  <li key={`rule-${i}`}>
                    {RULE_TYPE_LABELS[r.type] ?? r.type} ({r.target})
                    {r.block === true ? t('routers.security.profileSelect.blockingSuffix') : ''}
                  </li>
                ))}
                {(assignedProfile.pii.policies ?? []).map((p, i) => (
                  <li key={`pii-${i}`}>{t('routers.security.profileSelect.piiRedaction', { target: p.target })}{p.enabled === false ? t('routers.security.profileSelect.disabledSuffix') : ''}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {!profileAssigned && (
        <>
          <StartFromProfile
            options={profileOptions}
            hasCustom={rules.length > 0 || piiPolicies.length > 0}
            onCopy={copyProfile}
          />
          <SecurityRulesEditor
            rules={rules}
            setRules={setRules}
            piiPolicies={piiPolicies}
            setPiiPolicies={setPiiPolicies}
          />

        </>
      )}

      {(!profileAssigned || draft.isPending) && (
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saveDisabled}
          style={saved ? { background: '#16a34a', borderColor: '#16a34a' } : {}}
        >
          {saving ? (
            <span className="spinner" />
          ) : saved ? (
            <><Check size={15} style={{ marginRight: 6 }} />{t('routers.security.saved')}</>
          ) : (
            t('routers.security.saveButton')
          )}
        </button>
      )}
    </form>
  );
}
