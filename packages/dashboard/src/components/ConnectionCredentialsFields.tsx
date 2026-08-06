import React, { useState } from 'react';
import { EyeOff, Eye, Copy, Check, FlaskConical } from 'lucide-react';

// ── Provider metadata (shared by the model form and the connection form) ─────────
export const WEB_PROVIDERS = ['openai-web', 'anthropic-web'] as const;
export type WebProvider = typeof WEB_PROVIDERS[number];
export const isWebProvider = (p: string): p is WebProvider => (WEB_PROVIDERS as readonly string[]).includes(p);

export const WEB_PROVIDER_TOKEN_LABEL: Record<WebProvider, string> = {
  'openai-web': 'Access Token',
  'anthropic-web': 'Session Token',
};

export const WEB_PROVIDER_TOKEN_PLACEHOLDER: Record<WebProvider, string> = {
  'openai-web': 'eyJ…',
  'anthropic-web': 'Paste sessionKey cookie value (sk-ant-sid01-…)',
};

export const WEB_PROVIDER_INSTRUCTIONS: Record<WebProvider, React.ReactNode> = {
  'openai-web': (
    <>
      While logged in to ChatGPT, open{' '}
      <code style={{ fontSize: '0.78rem' }}>https://chatgpt.com/api/auth/session</code> in a new
      tab. Copy the value of the <code style={{ fontSize: '0.78rem' }}>accessToken</code> field
      (starts with <code style={{ fontSize: '0.78rem' }}>eyJ</code>).
      The token expires every ~24 hours.
      For reliable access, also fill in the <strong>cf_clearance</strong> field below.
    </>
  ),
  'anthropic-web': (
    <>
      <strong>How to get your session key:</strong> While logged in to Claude, open DevTools
      (F12) → Application → Cookies → <code style={{ fontSize: '0.78rem' }}>claude.ai</code>{' '}
      → copy the value of the{' '}
      <code style={{ fontSize: '0.78rem' }}>sessionKey</code> cookie
      (starts with <code style={{ fontSize: '0.78rem' }}>sk-ant-sid01-</code>).
      The key stays valid until you log out.
    </>
  ),
};

// Subscription providers store a long-lived OAuth token (Flow A) instead of an
// API key. The token is used verbatim as the upstream credential; the calling
// client must be a first-party-compatible client (e.g. Claude Code).
export const SUBSCRIPTION_PROVIDERS = ['anthropic-oauth', 'openai-oauth'] as const;
export type SubscriptionProvider = typeof SUBSCRIPTION_PROVIDERS[number];
export const isSubscriptionProvider = (p: string): p is SubscriptionProvider =>
  (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(p);

export const SUBSCRIPTION_TOKEN_LABEL: Record<SubscriptionProvider, string> = {
  'anthropic-oauth': 'Subscription OAuth Token',
  'openai-oauth': 'Auth file path',
};

export const SUBSCRIPTION_TOKEN_PLACEHOLDER: Record<SubscriptionProvider, string> = {
  'anthropic-oauth': 'sk-ant-oat01-…',
  'openai-oauth': '~/.codex/auth.json (default)',
};

export function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '0.5rem',
      background: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px',
      padding: '0.3rem 0.5rem 0.3rem 0.75rem',
      width: '100%',
    }}>
      <code style={{ fontSize: '0.88rem', letterSpacing: '0.01em', color: '#e2e8f0' }}>{text}</code>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        style={{
          background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.08)',
          border: '1px solid ' + (copied ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.18)'),
          borderRadius: '4px',
          color: copied ? '#4ade80' : '#cbd5e1',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexShrink: 0,
          fontSize: '0.72rem',
          padding: '3px 8px',
          transition: 'all 0.15s',
        }}
      >
        {copied
          ? <><Check size={12} /> Copied</>
          : <><Copy size={12} /> Copy</>
        }
      </button>
    </span>
  );
}

export const SUBSCRIPTION_INSTRUCTIONS: Record<SubscriptionProvider, React.ReactNode> = {
  'anthropic-oauth': (
    <>
      <strong>Use your Claude Pro/Max subscription.</strong>
      <ol style={{ margin: '0.5rem 0 0.25rem 1.2rem', padding: 0, lineHeight: 1.8 }}>
        <li>
          Run this command and copy the token it prints:
          <div style={{ margin: '0.3rem 0 0.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CopyCode text="claude setup-token" />
          </div>
        </li>
        <li>Paste the token into the <em>Subscription OAuth Token</em> field below.</li>
      </ol>
      <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
        Regenerate when it expires. Subscription use via a gateway may be against the provider&apos;s Terms.
      </span>
    </>
  ),
  'openai-oauth': (
    <>
      <strong>Use your ChatGPT Plus/Pro subscription via the Codex app.</strong>
      <ol style={{ margin: '0.5rem 0 0.25rem 1.2rem', padding: 0, lineHeight: 1.8 }}>
        <li>Log in to the Codex desktop app with your ChatGPT Plus/Pro account.</li>
        <li>
          Routerly reads your access token from <code style={{ fontSize: '0.8rem' }}>~/.codex/auth.json</code>{' '}
          and refreshes it automatically. No manual copy/paste needed.
        </li>
        <li>
          Leave the <em>Auth file path</em> field blank to use the default, or enter a custom path
          if your Codex app stores auth elsewhere.
        </li>
      </ol>
      <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
        Subscription use via a gateway may be against the provider&apos;s Terms.
      </span>
    </>
  ),
};

// ── Component contract ───────────────────────────────────────────────────────────
export interface CredentialValues {
  endpoint: string;
  apiKey: string;
  cfClearance: string;
  azureResourceName: string; azureDeploymentId: string; azureApiVersion: string;
  awsRegion: string; awsAccessKeyId: string; awsSecretAccessKey: string; awsSessionToken: string;
  vertexProjectId: string; vertexLocation: string; vertexServiceAccountKey: string;
}

export function emptyCredentialValues(): CredentialValues {
  return {
    endpoint: '', apiKey: '', cfClearance: '',
    azureResourceName: '', azureDeploymentId: '', azureApiVersion: '',
    awsRegion: '', awsAccessKeyId: '', awsSecretAccessKey: '', awsSessionToken: '',
    vertexProjectId: '', vertexLocation: '', vertexServiceAccountKey: '',
  };
}

export interface OAuthTestProp { status: 'idle' | 'testing' | 'ok' | 'error'; msg?: string | undefined; onTest: () => void }

interface Props {
  provider: string;
  values: CredentialValues;
  onChange: (patch: Partial<CredentialValues>) => void;
  editing: boolean;
  oauthTest?: OAuthTestProp | undefined;
  showEndpoint?: boolean | undefined;
  /** Whether the endpoint field is mandatory. Models always resolve an endpoint; connections may
   *  fall back to the provider default, so the connection form passes false. */
  endpointRequired?: boolean | undefined;
}

export function ConnectionCredentialsFields(props: Props) {
  const { provider, values, onChange, editing, oauthTest } = props;
  const endpointRequired = props.endpointRequired !== false;
  const [showToken, setShowToken] = useState(false);
  const [showCfClearance, setShowCfClearance] = useState(false);

  return (
    <>
      {isWebProvider(provider) && (
        <div style={{
          display: 'flex', gap: 10, padding: '12px 14px', marginBottom: 16,
          background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)',
          borderRadius: 8,
        }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
          <div style={{ fontSize: '0.82rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
            <p style={{ margin: '0 0 6px' }}>
              <strong>Unofficial provider — use at your own risk.</strong>{' '}
              This integration relies on an undocumented internal API that may change or break without notice.
              It may violate the provider&apos;s Terms of Service and could result in account suspension.
            </p>
            <p style={{ margin: 0 }}>{WEB_PROVIDER_INSTRUCTIONS[provider as WebProvider]}</p>
          </div>
        </div>
      )}

      {isSubscriptionProvider(provider) && (
        <div style={{
          display: 'flex', gap: 10, padding: '12px 14px', marginBottom: 16,
          background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)',
          borderRadius: 8,
        }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>ℹ️</span>
          <div style={{ fontSize: '0.82rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
            <p style={{ margin: 0 }}>{SUBSCRIPTION_INSTRUCTIONS[provider as SubscriptionProvider]}</p>
          </div>
        </div>
      )}

      {props.showEndpoint !== false && (
        <div className="form-group">
          <label className="form-label">
            Endpoint URL{!endpointRequired && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (optional)</span>}
          </label>
          <input className="form-input" value={values.endpoint}
            onChange={e => onChange({ endpoint: e.target.value })} required={endpointRequired} />
        </div>
      )}

      <div className="form-group">
        <label className="form-label">
          {isWebProvider(provider)
            ? WEB_PROVIDER_TOKEN_LABEL[provider as WebProvider]
            : isSubscriptionProvider(provider)
            ? SUBSCRIPTION_TOKEN_LABEL[provider as SubscriptionProvider]
            : 'API Key / Token'}
        </label>
        {provider === 'openai-oauth' && oauthTest ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="form-input" type="text"
                name="apiKey" autoComplete="off"
                value={values.apiKey} onChange={e => onChange({ apiKey: e.target.value })}
                placeholder={
                  editing ? 'Leave blank to keep existing path'
                  : '~/.codex/auth.json (default)'
                }
                style={{ flex: 1 }} />
              <button type="button"
                onClick={oauthTest.onTest}
                disabled={oauthTest.status === 'testing'}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '0 14px', height: 38, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                {oauthTest.status === 'testing' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <FlaskConical size={14} />}
                Test
              </button>
            </div>
            {oauthTest.status === 'ok' && (
              <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#4ade80' }}>
                {oauthTest.msg}
              </div>
            )}
            {oauthTest.status === 'error' && (
              <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#f87171' }}>
                {oauthTest.msg}
              </div>
            )}
          </>
        ) : (
          <div style={{ position: 'relative' }}>
            <input className="form-input" type={showToken ? 'text' : 'password'}
              name="apiKey" autoComplete="new-password"
              value={values.apiKey} onChange={e => onChange({ apiKey: e.target.value })}
              placeholder={
                editing ? 'Leave blank to keep existing key'
                : isWebProvider(provider) ? WEB_PROVIDER_TOKEN_PLACEHOLDER[provider as WebProvider]
                : isSubscriptionProvider(provider) ? SUBSCRIPTION_TOKEN_PLACEHOLDER[provider as SubscriptionProvider]
                : provider === 'ollama' ? 'not required for local models'
                : 'sk-…'
              }
              style={{ paddingRight: 40 }} />
            <button type="button" onClick={() => setShowToken(v => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        )}
      </div>

      {isWebProvider(provider) && (
        <div className="form-group">
          <label className="form-label">cf_clearance <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <div style={{ position: 'relative' }}>
            <input className="form-input" type={showCfClearance ? 'text' : 'password'}
              name="cfClearance" autoComplete="new-password"
              value={values.cfClearance} onChange={e => onChange({ cfClearance: e.target.value })}
              placeholder={editing ? 'Leave blank to keep existing' : ''}
              style={{ paddingRight: 40 }} />
            <button type="button" onClick={() => setShowCfClearance(v => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
              {showCfClearance ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* Azure OpenAI specific fields */}
      {provider === 'azure-openai' && (
        <>
          <div className="form-group">
            <label className="form-label">Azure Resource Name</label>
            <input className="form-input" value={values.azureResourceName}
              onChange={e => onChange({ azureResourceName: e.target.value })}
              placeholder="myresource" required />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>The Azure OpenAI resource name (from the Azure portal).</div>
          </div>
          <div className="form-group">
            <label className="form-label">Deployment ID</label>
            <input className="form-input" value={values.azureDeploymentId}
              onChange={e => onChange({ azureDeploymentId: e.target.value })}
              placeholder="gpt-4o-deployment" required />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>The deployment name you created in Azure OpenAI Studio.</div>
          </div>
          <div className="form-group">
            <label className="form-label">API Version <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(default: 2024-02-01)</span></label>
            <input className="form-input" value={values.azureApiVersion}
              onChange={e => onChange({ azureApiVersion: e.target.value })}
              placeholder="2024-02-01" />
          </div>
        </>
      )}

      {/* AWS Bedrock specific fields */}
      {provider === 'bedrock' && (
        <>
          <div className="form-group">
            <label className="form-label">AWS Region</label>
            <input className="form-input" value={values.awsRegion}
              onChange={e => onChange({ awsRegion: e.target.value })}
              placeholder="us-east-1" required />
          </div>
          <div className="form-group">
            <label className="form-label">AWS Access Key ID</label>
            <input className="form-input" value={values.awsAccessKeyId}
              onChange={e => onChange({ awsAccessKeyId: e.target.value })}
              placeholder="AKIAIOSFODNN7EXAMPLE" required />
          </div>
          <div className="form-group">
            <label className="form-label">AWS Secret Access Key</label>
            <input className="form-input" type="password" autoComplete="new-password"
              value={values.awsSecretAccessKey}
              onChange={e => onChange({ awsSecretAccessKey: e.target.value })}
              placeholder={editing ? 'Leave blank to keep existing' : 'wJalrXUtnFEMI/K7MDENG/…'} />
          </div>
          <div className="form-group">
            <label className="form-label">Session Token <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional, for temporary credentials)</span></label>
            <input className="form-input" type="password" autoComplete="new-password"
              value={values.awsSessionToken}
              onChange={e => onChange({ awsSessionToken: e.target.value })}
              placeholder="AQoDYXdz…" />
          </div>
        </>
      )}

      {/* Google Vertex AI specific fields */}
      {provider === 'vertex' && (
        <>
          <div className="form-group">
            <label className="form-label">GCP Project ID</label>
            <input className="form-input" value={values.vertexProjectId}
              onChange={e => onChange({ vertexProjectId: e.target.value })}
              placeholder="my-gcp-project" required />
          </div>
          <div className="form-group">
            <label className="form-label">Location <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(default: us-central1)</span></label>
            <input className="form-input" value={values.vertexLocation}
              onChange={e => onChange({ vertexLocation: e.target.value })}
              placeholder="us-central1" />
          </div>
          <div className="form-group">
            <label className="form-label">Service Account Key <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(JSON)</span></label>
            <textarea className="form-input" rows={6}
              value={values.vertexServiceAccountKey}
              onChange={e => onChange({ vertexServiceAccountKey: e.target.value })}
              placeholder={editing ? 'Leave blank to keep existing key' : 'Paste the contents of your service account JSON key file'}
              style={{ fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical' }} />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
              The full JSON content of a service account key with Vertex AI User role.
              If omitted, falls back to the API Key field as a Bearer token.
            </div>
          </div>
        </>
      )}
    </>
  );
}
