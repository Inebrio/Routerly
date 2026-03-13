import { requireAccount } from './store.js';
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

/** Performs a request using the currently active account. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const account = await requireAccount();
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
