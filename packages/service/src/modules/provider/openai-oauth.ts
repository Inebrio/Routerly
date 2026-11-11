import type { ProviderConnection } from '@routerly/shared';
import { OpenAIAdapter } from './openai.js';
import { decryptCredential } from '../../lib/crypto-cred.js';
import { OAuthRefreshHttpError, REFRESH_BUFFER_MS, reauthError, refreshConnectionTokens } from './oauth-refresh.js';

export class OpenAIOAuthAdapter extends OpenAIAdapter {}

// ─── OAuth credential resolution + refresh ──────────────────────────────────
// Client id is OpenAI's own public Codex CLI OAuth client, already used by
// lanes/openaiOAuthForward.ts for an unrelated (local ~/.codex/auth.json) flow.

const OPENAI_OAUTH_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

interface OpenAIOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Decodes the `exp` (seconds) claim of a JWT access token, in milliseconds. Returns 0 if unparseable. */
function jwtExpMs(token: string): number {
  try {
    const raw = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf-8');
    const exp = (JSON.parse(raw) as Record<string, unknown>)['exp'];
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Refreshes an OpenAI (Codex) OAuth access token. Expiry is derived from the returned JWT's `exp` claim. */
export async function refreshOpenAIOAuthToken(refreshToken: string): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OPENAI_OAUTH_CLIENT_ID,
  });
  const res = await fetch(OPENAI_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new OAuthRefreshHttpError(res.status, `openai oauth refresh failed: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data['access_token'] as string;
  const newRefreshToken = (data['refresh_token'] as string | undefined) ?? refreshToken;
  return { accessToken, refreshToken: newRefreshToken, expiresAt: jwtExpMs(accessToken) };
}

/**
 * Decrypts the stored access token for an openai-oauth connection and, when it is within
 * 5 minutes of expiry, renews it through the shared single-flight refresh (see oauth-refresh.ts).
 * A connection flagged as needing re-authorization fails fast. Unknown expiry (`expiresAt <= 0`, e.g. an
 * undecodable JWT) is treated as "don't force a refresh", mirroring the `exp > 0` guard in
 * openaiOAuthForward.ts's resolveCodexToken.
 */
export async function resolveOpenAIOAuthCredential(connection: ProviderConnection): Promise<string> {
  const creds = connection.credentials as { oauthEnc?: string; refreshEnc?: string; expiresAt?: number; apiKey?: string };
  if (connection.authState) throw reauthError(connection.authState);
  if (!creds.oauthEnc || !creds.refreshEnc || typeof creds.expiresAt !== 'number') {
    // No refreshable oauth pair. Fall back to a static bearer stored in apiKey (legacy/migrated
    // connections whose token predates the oauthEnc/refreshEnc mechanism); the adapter uses it
    // as-is with no refresh. Only fail when there is no usable credential at all.
    if (typeof creds.apiKey === 'string' && creds.apiKey) return creds.apiKey;
    throw new Error('oauth connection missing encrypted credentials');
  }
  if (creds.expiresAt <= 0 || Date.now() < creds.expiresAt - REFRESH_BUFFER_MS) return decryptCredential(creds.oauthEnc);
  return refreshConnectionTokens(connection, refreshOpenAIOAuthToken);
}
