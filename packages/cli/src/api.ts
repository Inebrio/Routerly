import { requireAccount, saveAccount } from './store.js';
import type { AccountEntry } from './store.js';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  account: AccountEntry,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${account.serverUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${account.token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as unknown as T;

  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    const message = (data as { error?: string }).error ?? res.statusText;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

/** Silently refreshes the access token using the refresh token when needed.
 * Triggers when: access token is expired OR expires within 5 minutes.
 * No-op (silent failure) if no refresh token is available or the call fails.
 */
async function trySilentRefresh(account: AccountEntry): Promise<AccountEntry> {
  if (!account.refreshToken) return account;
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const needsRefresh = account.expiresAt < Date.now() || (account.expiresAt - Date.now() < FIVE_MIN_MS);
  if (!needsRefresh) return account;
  try {
    const url = `${account.serverUrl.replace(/\/$/, '')}/api/auth/refresh`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: account.refreshToken }),
    });
    if (!res.ok) return account;
    const data = await res.json() as { token: string; refreshToken?: string };
    let expiresAt = Date.now() + 3600_000;
    try {
      const p = JSON.parse(Buffer.from(data.token.split('.')[0]!, 'base64url').toString()) as { exp?: number };
      if (p.exp) expiresAt = p.exp;
    } catch { /* keep default */ }
    const refreshed = { ...account, token: data.token, expiresAt, ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}) };
    await saveAccount(refreshed);
    return refreshed;
  } catch { /* silent failure — proceed with existing token */ }
  return account;
}

/** Performs a request using the currently active account. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let account = await requireAccount();
  account = await trySilentRefresh(account);
  // If token is still expired after refresh attempt, fail with a clear message
  if (account.expiresAt < Date.now()) {
    console.error(`Session for "${account.alias}" has expired. Run: routerly auth login`);
    process.exit(1);
  }
  return request<T>(account, method, path, body);
}

/** Performs a request using an explicit account (used during login). */
export async function apiWith<T>(
  account: AccountEntry,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(account, method, path, body);
}
