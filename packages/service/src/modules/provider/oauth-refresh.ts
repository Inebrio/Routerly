import type { ConnectionAuthReason, ConnectionAuthState, ProviderConnection } from '@routerly/shared';
import { decryptCredential, encryptCredential } from '../../lib/crypto-cred.js';
import { readConfig, writeConfig } from '../config/loader.js';

export const REFRESH_BUFFER_MS = 300_000; // 5 minutes before expiry

/** The connection cannot authenticate any more: a new login or token is needed (RFC 6749 `invalid_grant`, revoked/expired token). */
export class OAuthReauthError extends Error {
  constructor(readonly reason: ConnectionAuthReason, message: string) {
    super(message);
    this.name = 'OAuthReauthError';
  }
}

/** Token endpoint answered with an error status. */
export class OAuthRefreshHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'OAuthRefreshHttpError';
  }
}

export interface OAuthTokens { accessToken: string; refreshToken: string; expiresAt: number }

/** Message prefix distinguishing the cause in traces and usage records. */
export const OAUTH_ERROR_PREFIX: Record<ConnectionAuthReason | 'unauthorized', string> = {
  expired: 'oauth_expired',
  revoked: 'oauth_revoked',
  unauthorized: 'oauth_unauthorized',
};

/** Classifies a 401 answer of the model endpoint by its text: expired / revoked / generic unauthorized. */
export function classifyOAuthUpstreamFailure(status: number, text: string): ConnectionAuthReason | 'unauthorized' | undefined {
  if (status !== 401) return undefined;
  if (/revoked/i.test(text)) return 'revoked';
  if (/expired/i.test(text)) return 'expired';
  return 'unauthorized';
}

/** A token endpoint 400/401/403 means the refresh token is no longer usable; anything else is transient. */
function isRevocation(err: unknown): boolean {
  return err instanceof OAuthRefreshHttpError && [400, 401, 403].includes(err.status);
}

async function patchConnection(id: string, patch: (c: ProviderConnection) => ProviderConnection): Promise<void> {
  const connections = (await readConfig('connections')) ?? [];
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) return;
  connections[index] = patch(connections[index]!);
  await writeConfig('connections', connections);
}

export function reauthError(state: ConnectionAuthState): OAuthReauthError {
  return new OAuthReauthError(state.reason, `${OAUTH_ERROR_PREFIX[state.reason]}: ${state.message}`);
}

/** Records that the connection needs re-authorization. No write when the same state is already stored. */
export async function markConnectionReauth(connectionId: string, reason: ConnectionAuthReason, message: string): Promise<void> {
  const connections = (await readConfig('connections')) ?? [];
  const current = connections.find((c) => c.id === connectionId);
  if (!current || current.authState?.reason === reason) return;
  await patchConnection(connectionId, (c) => ({
    ...c,
    authState: { status: 'reauth_required', reason, message: message.slice(0, 300), since: new Date().toISOString() },
  }));
}

const inflight = new Map<string, Promise<string>>();

/**
 * Renews the stored token pair of a connection and returns the new access token.
 * One refresh per connection at a time: concurrent callers share it (a rotating refresh token would
 * otherwise be spent twice). The connection is re-read inside the flight so a refresh that just
 * completed is reused. A revoked refresh token marks the connection as needing re-authorization;
 * network errors and 5xx stay transient and leave the state untouched.
 */
export function refreshConnectionTokens(
  connection: ProviderConnection,
  refresh: (refreshToken: string) => Promise<OAuthTokens>,
): Promise<string> {
  const running = inflight.get(connection.id);
  if (running) return running;
  const flight = (async () => {
    const stored = ((await readConfig('connections')) ?? []).find((c) => c.id === connection.id) ?? connection;
    const creds = stored.credentials as { oauthEnc?: string; refreshEnc?: string; expiresAt?: number };
    if (stored.authState) throw reauthError(stored.authState);
    if (typeof creds.expiresAt === 'number' && creds.expiresAt > 0 && Date.now() < creds.expiresAt - REFRESH_BUFFER_MS) {
      return decryptCredential(creds.oauthEnc!);
    }
    let tokens: OAuthTokens;
    try {
      tokens = await refresh(decryptCredential(creds.refreshEnc!));
    } catch (err) {
      if (!isRevocation(err)) throw err;
      const message = `refresh token rejected (${(err as Error).message})`;
      await markConnectionReauth(stored.id, 'revoked', message);
      throw new OAuthReauthError('revoked', `${OAUTH_ERROR_PREFIX.revoked}: ${message}`);
    }
    await patchConnection(stored.id, ({ authState: _gone, ...c }) => ({
      ...c,
      credentials: {
        ...c.credentials,
        oauthEnc: encryptCredential(tokens.accessToken),
        refreshEnc: encryptCredential(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      },
    }));
    return tokens.accessToken;
  })().finally(() => inflight.delete(connection.id));
  inflight.set(connection.id, flight);
  return flight;
}

/**
 * Called with a model-endpoint answer of an OAuth connection. A 401 saying "expired"/"revoked" flags the
 * connection (nothing but a new token can fix it); a plain 401 is only labelled, never flagged. Returns the
 * cause prefix for the trace message. Failures to persist are swallowed: this is bookkeeping.
 */
export function noteOAuthUpstreamFailure(connectionId: string | undefined, status: number, text: string): string | undefined {
  const cause = classifyOAuthUpstreamFailure(status, text);
  if (!cause) return undefined;
  if (connectionId && cause !== 'unauthorized') void markConnectionReauth(connectionId, cause, text.trim().slice(0, 200)).catch(() => {});
  return OAUTH_ERROR_PREFIX[cause];
}
