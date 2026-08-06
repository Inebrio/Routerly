import type { ProviderConnection } from '@routerly/shared';
import { OpenAIAdapter } from './openai.js';
import { decryptCredential, encryptCredential } from '../../lib/crypto-cred.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { isModuleEnabled } from '../../core/modules/registry.js';

export class OpenAIOAuthAdapter extends OpenAIAdapter {}

// ─── OAuth credential resolution + refresh ──────────────────────────────────
// Client id is OpenAI's own public Codex CLI OAuth client, already used by
// lanes/openaiOAuthForward.ts for an unrelated (local ~/.codex/auth.json) flow.

const OPENAI_OAUTH_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REFRESH_BUFFER_MS = 300_000; // 5 minutes, mirrors REFRESH_BUFFER_SECONDS in openaiOAuthForward.ts

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
  if (!res.ok) throw new Error(`openai oauth refresh failed: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data['access_token'] as string;
  const newRefreshToken = (data['refresh_token'] as string | undefined) ?? refreshToken;
  return { accessToken, refreshToken: newRefreshToken, expiresAt: jwtExpMs(accessToken) };
}

/**
 * Decrypts the stored access token for an openai-oauth connection, refusing to run unless
 * the 'provider-oauth' module is enabled, and refreshing it (and persisting the refreshed
 * credential) if it's within 5 minutes of expiry. Unknown expiry (`expiresAt <= 0`, e.g. an
 * undecodable JWT) is treated as "don't force a refresh", mirroring the `exp > 0` guard in
 * openaiOAuthForward.ts's resolveCodexToken.
 */
export async function resolveOpenAIOAuthCredential(connection: ProviderConnection): Promise<string> {
  const records = await readConfig('modules');
  if (!isModuleEnabled(records, 'provider-oauth')) {
    throw new Error("openai-oauth: 'provider-oauth' module is disabled");
  }
  const creds = connection.credentials as { oauthEnc?: string; refreshEnc?: string; expiresAt?: number; apiKey?: string };
  if (!creds.oauthEnc || !creds.refreshEnc || typeof creds.expiresAt !== 'number') {
    // No refreshable oauth pair. Fall back to a static bearer stored in apiKey (legacy/migrated
    // connections whose token predates the oauthEnc/refreshEnc mechanism); the adapter uses it
    // as-is with no refresh. Only fail when there is no usable credential at all.
    if (typeof creds.apiKey === 'string' && creds.apiKey) return creds.apiKey;
    throw new Error('oauth connection missing encrypted credentials');
  }
  const accessToken = decryptCredential(creds.oauthEnc);

  if (creds.expiresAt <= 0 || Date.now() < creds.expiresAt - REFRESH_BUFFER_MS) {
    return accessToken;
  }

  const refreshed = await refreshOpenAIOAuthToken(decryptCredential(creds.refreshEnc));

  const connections = (await readConfig('connections')) ?? [];
  const index = connections.findIndex((c) => c.id === connection.id);
  if (index !== -1) {
    connections[index] = {
      ...connections[index]!,
      credentials: {
        ...connections[index]!.credentials,
        oauthEnc: encryptCredential(refreshed.accessToken),
        refreshEnc: encryptCredential(refreshed.refreshToken),
        expiresAt: refreshed.expiresAt,
      },
    };
    await writeConfig('connections', connections);
  }

  return refreshed.accessToken;
}
