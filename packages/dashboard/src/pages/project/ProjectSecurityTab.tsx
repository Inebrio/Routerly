import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  getProfiles,
  assignProjectProfiles,
  updateProject,
  type GuardrailConfig,
  type GuardrailRule,
  type PiiConfig,
  type PiiPolicy,
  type SecurityProfile,
} from '../../api';
import { SearchableSelect } from '../../components/SearchableSelect';
import {
  SecurityRulesEditor,
  RULE_TYPE_LABELS,
  normalizeGuardActions,
  validateSecurityRules,
  type RuleWithId,
} from '../../components/SecurityRulesEditor';
import { useProject } from './ProjectLayout';

export function ProjectSecurityTab() {
  const { project, setProject } = useProject();

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [profiles, setProfiles] = useState<SecurityProfile[]>([]);

  // Guardrails state
  const [detectInjection, setDetectInjection] = useState(false);
  const [rules, setRules] = useState<RuleWithId[]>([]);

  // PII state
  const [piiPolicies, setPiiPolicies] = useState<PiiPolicy[]>([]);

  // Rules and policies to install on the next project refresh, used when switching
  // from a profile to custom so the profile config becomes the editable starting point.
  const pending = React.useRef<{ rules: RuleWithId[]; pii: PiiPolicy[] } | null>(null);

  useEffect(() => {
    getProfiles('security')
      .then(list => setProfiles(list.filter((p): p is SecurityProfile => p.kind === 'security')))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    if (!project) return;
    if (pending.current) {
      setRules(pending.current.rules);
      setPiiPolicies(pending.current.pii);
      pending.current = null;
      return;
    }
    const g = project.guardrails;
    if (g) {
      setDetectInjection(g.detectInjection === true);
      setRules((g.rules ?? []).map(r => normalizeGuardActions({ ...r, _id: crypto.randomUUID() })));
    }
    const p = project.pii;
    if (p) {
      setPiiPolicies(p.policies ?? []);
    }
  }, [project]);

  const { regexErrorsByRule, moderationErrorIds } = validateSecurityRules(rules);
  const saveDisabled = saving || Object.keys(regexErrorsByRule).length > 0 || moderationErrorIds.size > 0;

  async function onAssignProfile(profileId: string) {
    /* v8 ignore next */
    if (!project) return;
    setErr('');
    try {
      const updated = await assignProjectProfiles(project.id, { security: profileId === '' ? null : profileId });
      setProject(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign security profile');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!project || saveDisabled) return;
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
      const updated = await updateProject(project.id, {
        name: project.name,
        models: project.models.map(m => ({ modelId: m.modelId, ...(m.prompt ? { prompt: m.prompt } : {}) })),
        guardrails: guardrailsPayload,
        pii: piiPayload,
      });
      setProject(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error saving security settings');
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  const assignedProfileId = project.securityProfileId ?? '';
  const profileAssigned = assignedProfileId !== '';
  const assignedProfile = profiles.find(p => p.id === assignedProfileId);
  const defaultProfileId = profiles.find(p => p.builtin)?.id ?? profiles[0]?.id ?? '';

  async function onSelectMode(next: 'profile' | 'custom') {
    if ((next === 'profile') === profileAssigned) return;
    if (next === 'profile') {
      if (!defaultProfileId) {
        setErr('No security profile available. Create one from the Profiles page.');
        return;
      }
      await onAssignProfile(defaultProfileId);
      return;
    }
    // Leaving a profile: its rules and policies become the editable starting point.
    if (assignedProfile) {
      pending.current = {
        rules: (assignedProfile.guardrails.rules ?? []).map(r => normalizeGuardActions({ ...r, _id: crypto.randomUUID() })),
        pii: assignedProfile.pii.policies ?? [],
      };
    }
    await onAssignProfile('');
  }

  return (
    <form onSubmit={(e) => { void handleSave(e); }} style={{ maxWidth: 800 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="form-group">
        <label className="form-label">Security</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Use a shared security profile, or define this project's own guardrails and PII policies.
        </p>

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

        {profileAssigned && (
          <>
            <SearchableSelect
              style={{ maxWidth: 420 }}
              ariaLabel="Security Profile"
              value={assignedProfileId}
              onChange={v => void onAssignProfile(v)}
              options={[
                ...profiles.filter(p => p.builtin).map(p => ({ value: p.id, label: `${p.label} (built-in)` })),
                ...profiles.filter(p => !p.builtin).map(p => ({ value: p.id, label: p.label })),
              ]}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
              Guardrails and PII policies come from the profile and follow its changes. Edit them on the Profiles page, or switch to Custom to start from a copy of them.
            </p>
            {assignedProfile && (
              <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {(assignedProfile.guardrails.rules ?? []).map((r, i) => (
                  <li key={`rule-${i}`}>
                    {RULE_TYPE_LABELS[r.type] ?? r.type} ({r.target})
                    {r.block === true ? ', blocking' : ''}
                  </li>
                ))}
                {(assignedProfile.pii.policies ?? []).map((p, i) => (
                  <li key={`pii-${i}`}>PII redaction ({p.target}){p.enabled === false ? ', disabled' : ''}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {!profileAssigned && (
        <>
          <SecurityRulesEditor
            rules={rules}
            setRules={setRules}
            piiPolicies={piiPolicies}
            setPiiPolicies={setPiiPolicies}
          />

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveDisabled}
            style={saved ? { background: '#16a34a', borderColor: '#16a34a' } : {}}
          >
            {saving ? (
              <span className="spinner" />
            ) : saved ? (
              <><Check size={15} style={{ marginRight: 6 }} />Saved!</>
            ) : (
              'Save Security Settings'
            )}
          </button>
        </>
      )}
    </form>
  );
}
