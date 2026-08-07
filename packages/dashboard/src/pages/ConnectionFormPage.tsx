import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, X } from 'lucide-react';
import { providersConf, suggestConnectionLabel } from '@routerly/shared';
import {
  getConnections, createConnection, updateConnection, getProviderDescriptors, testOpenAIOAuth,
  type ProviderDescriptor,
} from '../api';
import {
  ConnectionCredentialsFields, emptyCredentialValues, type CredentialValues,
} from '../components/ConnectionCredentialsFields';

/**
 * The endpoint a provider is reached at unless the account overrides it. Read from the
 * bundled provider list rather than the catalog API so the prefill also works for an
 * operator who may manage connections but not read models (T204). Providers that have no
 * fixed address (custom, the cloud ones, the web ones) return an empty string.
 */
function defaultEndpoint(providerId: string): string {
  return (providersConf as Record<string, { endpoint?: string }>)[providerId]?.endpoint ?? '';
}

/**
 * How the account behind a provider is obtained. That is the first thing an operator knows
 * ("I have an API key", "I pay for a Claude plan", "it runs on my own box"), so the picker
 * shows every provider at once under those headings instead of hiding them in a dropdown.
 *
 * The support level already separates the subscription and browser-session providers. The
 * cloud and self-hosted sets are named here because both are "native" support: the level says
 * how well Routerly speaks to the provider, not what an operator has to bring to use it.
 */
const CLOUD_PROVIDERS = new Set(['azure-openai', 'bedrock', 'vertex']);
const SELF_HOSTED_PROVIDERS = new Set(['ollama', 'custom']);
const PROVIDER_GROUPS = ['directApi', 'cloudPlatform', 'subscription', 'browserSession', 'selfHosted'] as const;

function providerGroup(p: ProviderDescriptor): typeof PROVIDER_GROUPS[number] {
  if (p.supportLevel === 'oauth') return 'subscription';
  if (p.supportLevel === 'web') return 'browserSession';
  if (CLOUD_PROVIDERS.has(p.id)) return 'cloudPlatform';
  if (SELF_HOSTED_PROVIDERS.has(p.id)) return 'selfHosted';
  return 'directApi';
}

export function ConnectionFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [providerId, setProviderId] = useState('');
  const [providerName, setProviderName] = useState('');
  const [label, setLabel] = useState('');
  const [takenLabels, setTakenLabels] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [values, setValues] = useState<CredentialValues>(emptyCredentialValues());
  const [oauthTest, setOauthTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'error'; msg?: string }>({ status: 'idle' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    async function init() {
      setLoading(true);
      setErr('');
      try {
        // Connections are read even when creating: the names already taken are what the
        // suggested name has to avoid.
        const [descriptors, connections] = await Promise.all([getProviderDescriptors(), getConnections()]);
        setProviders(descriptors);
        setTakenLabels(connections.filter(c => c.id !== id).map(c => c.label));
        if (isEditing && id) {
          const conn = connections.find(c => c.id === id);
          if (conn) {
            setProviderId(conn.providerId);
            setProviderName(conn.providerName ?? '');
            setLabel(conn.label);
            setEnabled(conn.enabled);
            const c = conn.credentials ?? {};
            setValues({
              ...emptyCredentialValues(),
              endpoint: conn.endpoint ?? '',
              // Non-secret cloud fields returned by the server; secrets stay blank (keep existing).
              awsAccessKeyId: c.awsAccessKeyId ?? '',
              awsRegion: c.awsRegion ?? '',
              azureResourceName: c.azureResourceName ?? '',
              azureDeploymentId: c.azureDeploymentId ?? '',
              azureApiVersion: c.azureApiVersion ?? '',
              VERTEXROUTERIDPLACEHOLDER: c.VERTEXROUTERIDPLACEHOLDER ?? '',
              vertexLocation: c.vertexLocation ?? '',
            });
          } else {
            setErr(t('connections.form.errors.notFound'));
          }
        } else {
          const first = descriptors[0]?.id ?? '';
          setProviderId(first);
          setValues(v => ({ ...v, endpoint: defaultEndpoint(first) }));
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('connections.form.errors.loadFailed'));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id, isEditing]);

  async function handleTestOAuth() {
    setOauthTest({ status: 'testing' });
    try {
      const res = await testOpenAIOAuth(values.apiKey || undefined);
      if (res.ok) {
        const expStr = res.expiresAt ? new Date(res.expiresAt).toLocaleString() : t('connections.form.oauth.unknown');
        setOauthTest({ status: 'ok', msg: t('connections.form.oauth.accountExpires', { account: res.accountId, expires: expStr }) });
      } else {
        setOauthTest({ status: 'error', msg: res.error ?? t('connections.form.oauth.unknownError') });
      }
    } catch (e) {
      setOauthTest({ status: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleSave() {
    setSaving(true);
    setErr('');
    const credentials: Record<string, string> = {
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
      ...(values.cfClearance ? { cfClearance: values.cfClearance } : {}),
      ...(values.azureResourceName ? { azureResourceName: values.azureResourceName } : {}),
      ...(values.azureDeploymentId ? { azureDeploymentId: values.azureDeploymentId } : {}),
      ...(values.azureApiVersion ? { azureApiVersion: values.azureApiVersion } : {}),
      ...(values.awsRegion ? { awsRegion: values.awsRegion } : {}),
      ...(values.awsAccessKeyId ? { awsAccessKeyId: values.awsAccessKeyId } : {}),
      ...(values.awsSecretAccessKey ? { awsSecretAccessKey: values.awsSecretAccessKey } : {}),
      ...(values.awsSessionToken ? { awsSessionToken: values.awsSessionToken } : {}),
      ...(values.VERTEXROUTERIDPLACEHOLDER ? { VERTEXROUTERIDPLACEHOLDER: values.VERTEXROUTERIDPLACEHOLDER } : {}),
      ...(values.vertexLocation ? { vertexLocation: values.vertexLocation } : {}),
      ...(values.vertexServiceAccountKey ? { vertexServiceAccountKey: values.vertexServiceAccountKey } : {}),
    };
    try {
      // Only a custom connection carries an upstream name; a named provider is its own name.
      const upstream = providerId === 'custom' ? providerName.trim() : '';
      if (isEditing && id) {
        const patch: Parameters<typeof updateConnection>[1] = {
          providerId,
          providerName: upstream,
          // Blank means "name it after the provider": the server generates the same slug
          // the field previews.
          label: label.trim(),
          ...(values.endpoint ? { endpoint: values.endpoint } : {}),
          enabled,
        };
        if (Object.keys(credentials).length > 0) patch.credentials = credentials;
        await updateConnection(id, patch);
      } else {
        await createConnection({
          providerId,
          ...(upstream ? { providerName: upstream } : {}),
          // Blank means "name it after the provider": the server generates the same slug
          // the field previews.
          label: label.trim(),
          ...(values.endpoint ? { endpoint: values.endpoint } : {}),
          enabled,
          credentials,
        });
      }
      navigate('/dashboard/connections');
    } catch (e) {
      setErr(e instanceof Error ? e.message : (isEditing ? t('connections.form.errors.updateFailed') : t('connections.form.errors.createFailed')));
      setSaving(false);
    }
  }

  const goBack = () => navigate('/dashboard/connections');

  // The exact name the server would generate, so a blank field is a preview and not a guess.
  const suggestedLabel = suggestConnectionLabel(
    providerId,
    providerId === 'custom' ? providerName.trim() || undefined : undefined,
    takenLabels,
  );

  if (loading) {
    return (
      <div className="page-body">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <button className="btn-icon" onClick={goBack} style={{ marginBottom: 16, display: 'inline-flex', padding: 4, width: 'fit-content' }}>
          <ArrowLeft size={16} /><span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>{t('connections.form.backToConnections')}</span>
        </button>
        {/* Same width as the form below, so the toggle sits over the form column
            instead of drifting to the far edge of the page. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, maxWidth: 800 }}>
          <h1>{isEditing ? t('connections.form.editTitle') : t('connections.form.addTitle')}</h1>
          {/* Whether the connection is live is a property of the whole page, not one more
              field to fill in, so it sits by the title instead of mid-form. */}
          <label htmlFor="conn-enabled" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 0,
          }}>
            <input type="checkbox" id="conn-enabled" checked={enabled}
              onChange={e => setEnabled(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            {t('connections.form.enabled')}
          </label>
        </div>
        <p>{isEditing ? t('connections.form.editSubtitle') : t('connections.form.addSubtitle')}</p>
      </div>

      <div className="page-body">
        <form onSubmit={e => { e.preventDefault(); handleSave(); }} autoComplete="off" style={{ maxWidth: 800 }}>
          {err && <div className="form-error">{err}</div>}

          <div className="form-section">
            <h3 className="section-title">{t('connections.form.sectionTitle')}</h3>
            <p className="section-desc">{t('connections.form.sectionDesc')}</p>

            <div className="form-group">
              <label className="form-label">{t('connections.form.provider')}</label>
              {PROVIDER_GROUPS.map(group => {
                const inGroup = providers.filter(p => providerGroup(p) === group);
                if (inGroup.length === 0) return null;
                const groupLabel = t(`connections.form.groups.${group}`);
                return (
                  <div key={group} className="provider-group">
                    <div className="provider-group-title">{groupLabel}</div>
                    <div className="provider-grid" role="group" aria-label={groupLabel}>
                      {inGroup.map(p => (
                        <button key={p.id} type="button" className="provider-tile"
                          aria-pressed={p.id === providerId}
                          onClick={() => {
                            setProviderId(p.id);
                            // Picking a provider carries its address with it, the way the model form
                            // has always done it: an endpoint left over from the previous provider
                            // would point the account at the wrong API (T204).
                            setValues(v => ({ ...v, endpoint: defaultEndpoint(p.id) }));
                          }}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {providerId === 'custom' && (
              <div className="form-group">
                <label className="form-label" htmlFor="conn-provider-name">
                  {t('connections.form.upstreamProvider.label')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('connections.form.upstreamProvider.hintLabel')}</span>
                </label>
                <input id="conn-provider-name" className="form-input"
                  value={providerName} onChange={e => setProviderName(e.target.value)}
                  placeholder={t('connections.form.upstreamProvider.placeholder')} required />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  <Trans i18nKey="connections.form.upstreamProvider.description" components={{ code: <code style={{ fontSize: '0.72rem' }} /> }} />
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="conn-name">{t('connections.form.name.label')}</label>
              <input id="conn-name" className="form-input" placeholder={suggestedLabel}
                value={label} onChange={e => setLabel(e.target.value)} />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                <Trans i18nKey="connections.form.name.hint" values={{ suggested: suggestedLabel }} components={{ code: <code style={{ fontSize: '0.72rem' }} /> }} />
              </div>
            </div>

            <ConnectionCredentialsFields
              provider={providerId}
              values={values}
              onChange={patch => setValues(v => ({ ...v, ...patch }))}
              editing={isEditing}
              endpointRequired={false}
              oauthTest={providerId === 'openai-oauth'
                ? { status: oauthTest.status, msg: oauthTest.msg, onTest: handleTestOAuth }
                : undefined}
            />
            {isEditing && (
              <p className="section-desc" style={{ marginTop: 4 }}>{t('connections.form.credentialsBlankHint')}</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : <><Save size={14} /> {isEditing ? t('connections.form.save') : t('connections.form.create')}</>}
            </button>
            <button type="button" className="btn btn-secondary" onClick={goBack}>
              <X size={14} /> {t('connections.form.cancel')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
