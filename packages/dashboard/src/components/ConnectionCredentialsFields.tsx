import React, { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EyeOff, Eye, Copy, Check, FlaskConical } from 'lucide-react';

// ── Provider metadata (shared by the model form and the connection form) ─────────
export const WEB_PROVIDERS = ['openai-web', 'anthropic-web'] as const;
export type WebProvider = typeof WEB_PROVIDERS[number];
export const isWebProvider = (p: string): p is WebProvider => (WEB_PROVIDERS as readonly string[]).includes(p);

export function webProviderTokenLabel(t: TFunction, p: WebProvider): string {
  return p === 'openai-web'
    ? t('common.connectionFields.webProvider.accessTokenLabel')
    : t('common.connectionFields.webProvider.sessionTokenLabel');
}

export function webProviderTokenPlaceholder(t: TFunction, p: WebProvider): string {
  return p === 'openai-web'
    ? t('common.connectionFields.webProvider.accessTokenPlaceholder')
    : t('common.connectionFields.webProvider.sessionTokenPlaceholder');
}

const codeComponents = { code: <code style={{ fontSize: '0.78rem' }} />, strong: <strong /> };

export const WEB_PROVIDER_INSTRUCTIONS: Record<WebProvider, React.ReactNode> = {
  'openai-web': (
    <Trans i18nKey="common.connectionFields.webProvider.openaiInstructions" components={codeComponents} />
  ),
  'anthropic-web': (
    <Trans i18nKey="common.connectionFields.webProvider.anthropicInstructions" components={codeComponents} />
  ),
};

// Subscription providers store a long-lived OAuth token (Flow A) instead of an
// API key. The token is used verbatim as the upstream credential; the calling
// client must be a first-party-compatible client (e.g. Claude Code).
export const SUBSCRIPTION_PROVIDERS = ['anthropic-oauth', 'openai-oauth'] as const;
export type SubscriptionProvider = typeof SUBSCRIPTION_PROVIDERS[number];
export const isSubscriptionProvider = (p: string): p is SubscriptionProvider =>
  (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(p);

export function subscriptionTokenLabel(t: TFunction, p: SubscriptionProvider): string {
  return p === 'anthropic-oauth'
    ? t('common.connectionFields.subscriptionProvider.oauthTokenLabel')
    : t('common.connectionFields.subscriptionProvider.authFilePathLabel');
}

export function subscriptionTokenPlaceholder(t: TFunction, p: SubscriptionProvider): string {
  return p === 'anthropic-oauth'
    ? t('common.connectionFields.subscriptionProvider.oauthTokenPlaceholder')
    : t('common.connectionFields.subscriptionProvider.authFilePathPlaceholder');
}

export function CopyCode({ text }: { text: string }) {
  const { t } = useTranslation();
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
        title={copied ? t('common.connectionFields.copyCode.copiedTooltip') : t('common.connectionFields.copyCode.copyTooltip')}
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
          ? <><Check size={12} /> {t('common.connectionFields.copyCode.copiedLabel')}</>
          : <><Copy size={12} /> {t('common.connectionFields.copyCode.copyLabel')}</>
        }
      </button>
    </span>
  );
}

const emComponents = { em: <em /> };

export const SUBSCRIPTION_INSTRUCTIONS: Record<SubscriptionProvider, React.ReactNode> = {
  'anthropic-oauth': (
    <>
      <strong><Trans i18nKey="common.connectionFields.subscriptionProvider.anthropicTitle" /></strong>
      <ol style={{ margin: '0.5rem 0 0.25rem 1.2rem', padding: 0, lineHeight: 1.8 }}>
        <li>
          <Trans i18nKey="common.connectionFields.subscriptionProvider.anthropicRunCommandStep" />
          <div style={{ margin: '0.3rem 0 0.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CopyCode text="claude setup-token" />
          </div>
        </li>
        <li><Trans i18nKey="common.connectionFields.subscriptionProvider.anthropicPasteTokenStep" components={emComponents} /></li>
      </ol>
      <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
        <Trans i18nKey="common.connectionFields.subscriptionProvider.termsNote" />
      </span>
    </>
  ),
  'openai-oauth': (
    <>
      <strong><Trans i18nKey="common.connectionFields.subscriptionProvider.openaiTitle" /></strong>
      <ol style={{ margin: '0.5rem 0 0.25rem 1.2rem', padding: 0, lineHeight: 1.8 }}>
        <li><Trans i18nKey="common.connectionFields.subscriptionProvider.openaiLoginStep" /></li>
        <li>
          <Trans i18nKey="common.connectionFields.subscriptionProvider.openaiAutoRefreshStep" components={{ code: <code style={{ fontSize: '0.8rem' }} /> }} />
        </li>
        <li>
          <Trans i18nKey="common.connectionFields.subscriptionProvider.openaiAuthFilePathStep" components={emComponents} />
        </li>
      </ol>
      <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
        <Trans i18nKey="common.connectionFields.subscriptionProvider.openaiTermsNote" />
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
  VERTEXROUTERIDPLACEHOLDER: string; vertexLocation: string; vertexServiceAccountKey: string;
}

export function emptyCredentialValues(): CredentialValues {
  return {
    endpoint: '', apiKey: '', cfClearance: '',
    azureResourceName: '', azureDeploymentId: '', azureApiVersion: '',
    awsRegion: '', awsAccessKeyId: '', awsSecretAccessKey: '', awsSessionToken: '',
    VERTEXROUTERIDPLACEHOLDER: '', vertexLocation: '', vertexServiceAccountKey: '',
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
  const { t } = useTranslation();
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
              <strong>{t('common.connectionFields.webProvider.unofficialWarningTitle')}</strong>{' '}
              {t('common.connectionFields.webProvider.unofficialWarningBody')}
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
            {t('common.connectionFields.endpointUrl')}{!endpointRequired && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {t('common.connectionFields.optional')}</span>}
          </label>
          <input className="form-input" value={values.endpoint}
            onChange={e => onChange({ endpoint: e.target.value })} required={endpointRequired} />
        </div>
      )}

      <div className="form-group">
        <label className="form-label">
          {isWebProvider(provider)
            ? webProviderTokenLabel(t, provider)
            : isSubscriptionProvider(provider)
            ? subscriptionTokenLabel(t, provider)
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
                : isWebProvider(provider) ? webProviderTokenPlaceholder(t, provider)
                : isSubscriptionProvider(provider) ? subscriptionTokenPlaceholder(t, provider)
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
            <label className="form-label">{t('common.connectionFields.azureResourceName')}</label>
            <input className="form-input" value={values.azureResourceName}
              onChange={e => onChange({ azureResourceName: e.target.value })}
              placeholder={t('common.connectionFields.azureResourceNamePlaceholder')} required />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('common.connectionFields.azureResourceNameHint')}</div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.deploymentId')}</label>
            <input className="form-input" value={values.azureDeploymentId}
              onChange={e => onChange({ azureDeploymentId: e.target.value })}
              placeholder={t('common.connectionFields.deploymentIdPlaceholder')} required />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('common.connectionFields.deploymentIdHint')}</div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.azureApiVersionLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('common.connectionFields.azureApiVersionDefaultHint')}</span></label>
            <input className="form-input" value={values.azureApiVersion}
              onChange={e => onChange({ azureApiVersion: e.target.value })}
              placeholder={t('common.connectionFields.azureApiVersionPlaceholder')} />
          </div>
        </>
      )}

      {/* AWS Bedrock specific fields */}
      {provider === 'bedrock' && (
        <>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.awsRegion')}</label>
            <input className="form-input" value={values.awsRegion}
              onChange={e => onChange({ awsRegion: e.target.value })}
              placeholder={t('common.connectionFields.awsRegionPlaceholder')} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.awsAccessKeyId')}</label>
            <input className="form-input" value={values.awsAccessKeyId}
              onChange={e => onChange({ awsAccessKeyId: e.target.value })}
              placeholder={t('common.connectionFields.awsAccessKeyIdPlaceholder')} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.awsSecretAccessKey')}</label>
            <input className="form-input" type="password" autoComplete="new-password"
              value={values.awsSecretAccessKey}
              onChange={e => onChange({ awsSecretAccessKey: e.target.value })}
              placeholder={editing ? t('common.connectionFields.awsSecretAccessKeyPlaceholderExisting') : t('common.connectionFields.awsSecretAccessKeyPlaceholderNew')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.awsSessionTokenLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('common.connectionFields.awsSessionTokenOptionalHint')}</span></label>
            <input className="form-input" type="password" autoComplete="new-password"
              value={values.awsSessionToken}
              onChange={e => onChange({ awsSessionToken: e.target.value })}
              placeholder={t('common.connectionFields.awsSessionTokenPlaceholder')} />
          </div>
        </>
      )}

      {/* Google Vertex AI specific fields */}
      {provider === 'vertex' && (
        <>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.gcpRouterId')}</label>
            <input className="form-input" value={values.VERTEXROUTERIDPLACEHOLDER}
              onChange={e => onChange({ VERTEXROUTERIDPLACEHOLDER: e.target.value })}
              placeholder={t('common.connectionFields.gcpRouterIdPlaceholder')} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.gcpLocationLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('common.connectionFields.gcpLocationDefaultHint')}</span></label>
            <input className="form-input" value={values.vertexLocation}
              onChange={e => onChange({ vertexLocation: e.target.value })}
              placeholder={t('common.connectionFields.gcpLocationPlaceholder')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('common.connectionFields.gcpServiceAccountKeyLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('common.connectionFields.gcpServiceAccountKeyJsonHint')}</span></label>
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
