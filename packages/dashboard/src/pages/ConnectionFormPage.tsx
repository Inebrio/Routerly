import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, X } from 'lucide-react';
import {
  getConnections, createConnection, updateConnection, getProviderDescriptors, testOpenAIOAuth,
  type ProviderDescriptor,
} from '../api';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  ConnectionCredentialsFields, emptyCredentialValues, type CredentialValues,
} from '../components/ConnectionCredentialsFields';

export function ConnectionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [providerId, setProviderId] = useState('');
  const [label, setLabel] = useState('');
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
        const descriptors = await getProviderDescriptors();
        setProviders(descriptors);
        if (isEditing && id) {
          const connections = await getConnections();
          const conn = connections.find(c => c.id === id);
          if (conn) {
            setProviderId(conn.providerId);
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
              vertexProjectId: c.vertexProjectId ?? '',
              vertexLocation: c.vertexLocation ?? '',
            });
          } else {
            setErr('Connection not found');
          }
        } else {
          setProviderId(descriptors[0]?.id ?? '');
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load connection');
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
        const expStr = res.expiresAt ? new Date(res.expiresAt).toLocaleString() : 'unknown';
        setOauthTest({ status: 'ok', msg: `Account: ${res.accountId} — expires ${expStr}` });
      } else {
        setOauthTest({ status: 'error', msg: res.error ?? 'Unknown error' });
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
      ...(values.vertexProjectId ? { vertexProjectId: values.vertexProjectId } : {}),
      ...(values.vertexLocation ? { vertexLocation: values.vertexLocation } : {}),
      ...(values.vertexServiceAccountKey ? { vertexServiceAccountKey: values.vertexServiceAccountKey } : {}),
    };
    try {
      if (isEditing && id) {
        const patch: Parameters<typeof updateConnection>[1] = {
          providerId,
          label,
          ...(values.endpoint ? { endpoint: values.endpoint } : {}),
          enabled,
        };
        if (Object.keys(credentials).length > 0) patch.credentials = credentials;
        await updateConnection(id, patch);
      } else {
        await createConnection({
          providerId,
          label,
          ...(values.endpoint ? { endpoint: values.endpoint } : {}),
          enabled,
          credentials,
        });
      }
      navigate('/dashboard/connections');
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Failed to ${isEditing ? 'update' : 'create'} connection`);
      setSaving(false);
    }
  }

  const goBack = () => navigate('/dashboard/connections');

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
          <ArrowLeft size={16} /><span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>Back to Connections</span>
        </button>
        <h1>{isEditing ? 'Edit Connection' : 'Add Connection'}</h1>
        <p>{isEditing ? 'Update the provider account settings' : 'Register a new provider account'}</p>
      </div>

      <div className="page-body">
        <form onSubmit={e => { e.preventDefault(); handleSave(); }} autoComplete="off" style={{ maxWidth: 800 }}>
          {err && <div className="form-error">{err}</div>}

          <div className="form-section">
            <h3 className="section-title">Connection details</h3>
            <p className="section-desc">Provider account, credentials, and endpoint used to perform requests.</p>

            <div className="form-group">
              <label className="form-label">Provider</label>
              <SearchableSelect
                options={providers.map(p => ({ value: p.id, label: p.label }))}
                value={providerId}
                onChange={setProviderId}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="conn-label">Label</label>
              <input id="conn-label" className="form-input" placeholder="e.g. Primary OpenAI account"
                value={label} onChange={e => setLabel(e.target.value)} />
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="conn-enabled" checked={enabled}
                onChange={e => setEnabled(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="conn-enabled" style={{ cursor: 'pointer', marginBottom: 0 }}>Enabled</label>
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
              <p className="section-desc" style={{ marginTop: 4 }}>Leave credential fields blank to keep existing values.</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving || !label.trim()}>
              {saving ? <span className="spinner" /> : <><Save size={14} /> {isEditing ? 'Save' : 'Create'}</>}
            </button>
            <button type="button" className="btn btn-secondary" onClick={goBack}>
              <X size={14} /> Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
