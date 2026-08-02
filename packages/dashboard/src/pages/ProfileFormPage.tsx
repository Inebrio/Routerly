import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, ShieldOff } from 'lucide-react';
import {
  getProfiles, createProfile, updateProfile, getModels, getInstalledOptimizers,
  type CreateProfileBody, type FallbackStrategyType, type InstalledOptimizer, type Model,
  type PiiPolicy, type Profile, type ProfileKind, type SelectorType,
} from '../api';
import { RoutingPoliciesEditor, mkPolicyId, type PolicyItem } from '../components/RoutingPoliciesEditor';
import {
  OptimizerStepsEditor, buildOptimizerSteps, mergeOptimizerRows, type OptimizerRow,
} from '../components/OptimizerStepsEditor';
import {
  SecurityRulesEditor, normalizeGuardActions, validateSecurityRules, type RuleWithId,
} from '../components/SecurityRulesEditor';
import { KIND_LABELS } from './ProfilesPage';
import { useAuth } from '../AuthContext';

const LABEL_PLACEHOLDERS: Record<ProfileKind, string> = {
  routing: 'e.g. My Balanced Routing',
  optimizer: 'e.g. My Prompt Trimmer',
  security: 'e.g. My Strict Guardrails',
};

/**
 * One form per profile kind: the kind is fixed by where you came from, either
 * the tab that opened the create page (`?kind=<kind>`), the profile being
 * cloned (`?base=<id>`) or the profile being edited. Nothing on the form asks
 * for it, since the three kinds share no field beyond the label; the config
 * editors are the same ones the project tabs use.
 */
export function ProfileFormPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canRead = can('profiles:read');
  const canManage = can('profiles:manage');

  const isCreate = id === undefined;
  const baseId = searchParams.get('base') ?? '';
  const kindParam = searchParams.get('kind');
  const initialKind: ProfileKind =
    kindParam === 'optimizer' || kindParam === 'security' ? kindParam : 'routing';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [builtin, setBuiltin] = useState(false);

  const [kind, setKind] = useState<ProfileKind>(initialKind);
  const [label, setLabel] = useState('');

  // Routing. Selector and fallback strategy are no longer editable here (T112):
  // the engine defaults cover every real setup, and the two knobs asked operators
  // a question they had no way to answer. They are still round-tripped so editing
  // a profile that was created with other values does not silently reset them.
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [selector, setSelector] = useState<SelectorType>('argmax');
  const [fallbackStrategy, setFallbackStrategy] = useState<FallbackStrategyType>('next-best');
  const [models, setModels] = useState<Model[]>([]);

  // Optimizer
  const [rows, setRows] = useState<OptimizerRow[]>([]);

  // Security
  const [rules, setRules] = useState<RuleWithId[]>([]);
  const [piiPolicies, setPiiPolicies] = useState<PiiPolicy[]>([]);

  /** Loads a profile's config into the form. Used both for edit and for clone. */
  function fill(p: Profile, installedOptimizers: InstalledOptimizer[]) {
    setKind(p.kind);
    if (p.kind === 'routing') {
      setPolicies(p.policies.map(pol => ({ ...pol, internalId: mkPolicyId() })));
      setSelector(p.selector);
      setFallbackStrategy(p.fallbackStrategy);
    } else if (p.kind === 'optimizer') {
      setRows(mergeOptimizerRows(p.optimizers.steps, installedOptimizers));
    } else {
      setRules((p.guardrails.rules ?? []).map(r => normalizeGuardActions({ ...r, _id: crypto.randomUUID() })));
      setPiiPolicies(p.pii.policies ?? []);
    }
  }

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    Promise.all([getProfiles(), getModels().catch(() => []), getInstalledOptimizers().catch(() => [])])
      .then(([list, ms, opts]) => {
        setModels(ms);
        const source = list.find(p => p.id === (isCreate ? baseId : id));
        if (!isCreate && !source) {
          setError('Profile not found.');
          return;
        }
        if (source) {
          fill(source, opts);
          setLabel(isCreate ? `${source.label} copy` : source.label);
          setBuiltin(!isCreate && source.builtin);
        } else {
          setRows(mergeOptimizerRows([], opts));
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [canRead, id, baseId, isCreate]);

  const { regexErrorsByRule, moderationErrorIds } = validateSecurityRules(rules);
  const securityInvalid = Object.keys(regexErrorsByRule).length > 0 || moderationErrorIds.size > 0;
  const readOnly = builtin || !canManage;
  const saveDisabled = saving || !label.trim() || (kind === 'security' && securityInvalid);

  function configBody() {
    if (kind === 'routing') {
      return { policies: policies.map(({ internalId: _drop, ...rest }) => rest), selector, fallbackStrategy };
    }
    if (kind === 'optimizer') {
      return { optimizers: { steps: buildOptimizerSteps(rows) } };
    }
    return {
      guardrails: { rules: rules.map(({ _id: _drop, ...rest }) => rest) },
      pii: { policies: piiPolicies },
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveDisabled) return;
    setSaving(true);
    setError('');
    try {
      if (isCreate) {
        await createProfile({ kind, label: label.trim(), ...configBody() } as CreateProfileBody);
      } else {
        await updateProfile(id, { label: label.trim(), ...configBody() });
      }
      navigate('/dashboard/profiles');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view profiles.</p></div>;
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <>
      <div className="page-header">
        <button
          type="button"
          className="btn-icon"
          style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6, padding: 4, width: 'fit-content' }}
          onClick={() => navigate('/dashboard/profiles')}
        >
          <ArrowLeft size={16} />
          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>Back to Profiles</span>
        </button>
        <h1>{isCreate ? `New ${KIND_LABELS[kind]} Profile` : readOnly ? label : `Edit ${label}`}</h1>
        <p>
          {readOnly
            ? 'Built-in profiles cannot be edited. Clone one to customize it.'
            : `A${kind === 'optimizer' ? 'n' : ''} ${KIND_LABELS[kind].toLowerCase()} profile can be assigned to any number of projects.`}
        </p>
      </div>

      <div className="page-body">
        <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
          {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

          <div className="form-group" style={{ maxWidth: 400, marginBottom: 24 }}>
            <label className="form-label" htmlFor="profile-label">Label</label>
            <input
              id="profile-label"
              className="form-input"
              placeholder={LABEL_PLACEHOLDERS[kind]}
              value={label}
              disabled={readOnly}
              onChange={e => setLabel(e.target.value)}
            />
          </div>

          <div style={readOnly ? { pointerEvents: 'none', opacity: 0.7 } : {}}>
            {/* Each editor prints its own heading, so the form does not repeat it. */}
            {kind === 'routing' && (
              <RoutingPoliciesEditor policies={policies} setPolicies={setPolicies} availableModels={models} />
            )}

            {kind === 'optimizer' && (
              <>
                <label className="form-label" style={{ display: 'block', marginBottom: 8 }}>Optimizers</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Drag to reorder, toggle to enable. They run in order from top to bottom.
                </p>
                <OptimizerStepsEditor rows={rows} setRows={setRows} disabled={readOnly} />
              </>
            )}

            {kind === 'security' && (
              <SecurityRulesEditor
                rules={rules}
                setRules={setRules}
                piiPolicies={piiPolicies}
                setPiiPolicies={setPiiPolicies}
              />
            )}
          </div>

          {!readOnly && (
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button type="submit" className="btn btn-primary" disabled={saveDisabled}>
                {saving ? <span className="spinner" /> : <><Save size={14} /> {isCreate ? 'Create Profile' : 'Save Profile'}</>}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard/profiles')}>
                Cancel
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
