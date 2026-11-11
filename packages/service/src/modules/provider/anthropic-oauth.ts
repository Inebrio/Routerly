import Anthropic from '@anthropic-ai/sdk';
import type { ModelConfig, ProviderConnection } from '@routerly/shared';
import { AnthropicAdapter } from './anthropic.js';
import { decryptCredential } from '../../lib/crypto-cred.js';
import { OAuthRefreshHttpError, REFRESH_BUFFER_MS, reauthError, refreshConnectionTokens } from './oauth-refresh.js';

const OAUTH_BETA = 'oauth-2025-04-20';

export class AnthropicOAuthAdapter extends AnthropicAdapter {
  protected override getClient(model: ModelConfig): Anthropic {
    return new Anthropic({
      authToken: model.apiKey ?? '',
      baseURL: model.endpoint || 'https://api.anthropic.com',
      timeout: model.timeout ?? 60000,
      maxRetries: 0, // retry/failover is Routerly's job (resilience + candidate loop); SDK retries multiplied the timeout x3
      defaultHeaders: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': OAUTH_BETA,
      },
    });
  }
}

// ─── OAuth credential resolution + refresh ──────────────────────────────────
// Client id is Anthropic's own public OAuth client for the official `claude`
// CLI (`claude setup-token`), not a Routerly secret.

const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_OAUTH_URL_PRIMARY = 'https://platform.claude.com/v1/oauth/token';
const ANTHROPIC_OAUTH_URL_FALLBACK = 'https://console.anthropic.com/v1/oauth/token';
const REFRESH_TIMEOUT_MS = 15_000;

interface AnthropicOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function postAnthropicRefresh(url: string, refreshToken: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS), // a stalled token endpoint must not hang every request
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    }),
  });
}

/** Refreshes an Anthropic OAuth access token. Retries once against the console.anthropic.com fallback. */
export async function refreshAnthropicOAuthToken(refreshToken: string): Promise<AnthropicOAuthTokens> {
  let res: Response;
  try {
    res = await postAnthropicRefresh(ANTHROPIC_OAUTH_URL_PRIMARY, refreshToken);
    if (!res.ok) throw new OAuthRefreshHttpError(res.status, `anthropic oauth refresh failed: HTTP ${res.status}`);
  } catch {
    res = await postAnthropicRefresh(ANTHROPIC_OAUTH_URL_FALLBACK, refreshToken);
    if (!res.ok) throw new OAuthRefreshHttpError(res.status, `anthropic oauth refresh failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data['access_token'] as string;
  const newRefreshToken = (data['refresh_token'] as string | undefined) ?? refreshToken;
  // expires_in missing → unknown expiry, sentinel 0 (not Date.now(): that would read as
  // "already expired" on the very next check and force-refresh every request).
  const expiresInRaw = data['expires_in'] as number | undefined;
  const expiresAt = typeof expiresInRaw === 'number' ? Date.now() + expiresInRaw * 1000 : 0;
  return { accessToken, refreshToken: newRefreshToken, expiresAt };
}

/**
 * Decrypts the stored access token for an anthropic-oauth connection and, when it is within
 * 5 minutes of expiry, renews it through the shared single-flight refresh (see oauth-refresh.ts).
 * A connection flagged as needing re-authorization fails fast. Unknown expiry (`expiresAt <= 0`)
 * is treated as "don't force a refresh", mirroring the `exp > 0` guard in openaiOAuthForward.ts.
 */
export async function resolveAnthropicOAuthCredential(connection: ProviderConnection): Promise<string> {
  const creds = connection.credentials as { oauthEnc?: string; refreshEnc?: string; expiresAt?: number; apiKey?: string };
  if (connection.authState) throw reauthError(connection.authState);
  if (!creds.oauthEnc) {
    // Legacy/migrated connections keep a static bearer in apiKey; no refresh.
    if (typeof creds.apiKey === 'string' && creds.apiKey) return creds.apiKey;
    throw new Error('oauth connection missing encrypted credentials');
  }
  // A `claude setup-token` token is long-lived and comes without refresh token or expiry
  // (the connection stores only oauthEnc): use it as-is, there is nothing to refresh.
  if (!creds.refreshEnc || typeof creds.expiresAt !== 'number') return decryptCredential(creds.oauthEnc);
  if (creds.expiresAt <= 0 || Date.now() < creds.expiresAt - REFRESH_BUFFER_MS) return decryptCredential(creds.oauthEnc);
  return refreshConnectionTokens(connection, refreshAnthropicOAuthToken);
}
