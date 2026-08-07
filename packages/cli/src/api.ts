import { requireAccount, saveAccount } from './store.js';
import type { AccountEntry } from './store.js';
import type { PermissionCheckStatus } from '@routerly/shared';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── RTR-04: config-file permission guard ────────────────────────────────────
// The service hard-blocks every /api/* route (423) when a secrets file has
// unsafe permissions, except these — see the blueprint's frozen contact points.
const PERMISSION_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/system/permissions',
  '/api/system/permissions/fix',
]);

// Memoized per CLI process: a single command can make several API calls
// (e.g. `routerly status`), but the guard must only check/prompt once (AC5).
let permissionCheck: Promise<void> | null = null;
let warningsPrinted = false;

/** Resets the memoized permission-check state. Exported for tests only —
 * a real CLI invocation is a fresh process, so this never runs in production. */
export function resetPermissionCheckCache(): void {
  permissionCheck = null;
  warningsPrinted = false;
}

/** Marks the permission check as already resolved safe, skipping the GET
 * /api/system/permissions round trip entirely. Exported for tests only, so
 * suites unrelated to the permission guard don't need to mock that call. */
export function primePermissionCheckSafeForTests(): void {
  permissionCheck = Promise.resolve();
  warningsPrinted = false;
}

function printUnsafeFiles(unsafe: PermissionCheckStatus['unsafe']): void {
  for (const u of unsafe) {
    console.error(`  - ${u.file} (${u.path}) — mode ${u.mode}`);
  }
}

/** Prompts the operator to confirm, then calls the fix endpoint on "yes".
 * Exits the process (code 1) on "no" — never fixes without explicit consent (AC2/AC3). */
async function confirmAndFix(account: AccountEntry, secretFiles: PermissionCheckStatus['unsafe']): Promise<void> {
  console.error('Routerly refuses to proceed: the following configuration file(s) have unsafe permissions and may expose secrets to other local users:');
  printUnsafeFiles(secretFiles);
  console.error('Routerly will not fix this automatically — it requires your confirmation.');

  const { default: inquirer } = await import('inquirer');
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Fix these permissions now?',
    default: false,
  }]) as { confirm: boolean };

  if (!confirm) {
    console.error('Aborted: permissions were not fixed. The command will not proceed.');
    process.exit(1);
  }

  await rawRequest<{ fixed: string[] }>(account, 'POST', '/api/system/permissions/fix', { confirm: true });
}

/** Fetches GET /api/system/permissions once per process and enforces it:
 * blocks + prompts + fixes on "blocked", prints warnings once, no-ops when safe (AC8). */
async function ensurePermissionsSafe(account: AccountEntry): Promise<void> {
  if (!permissionCheck) {
    permissionCheck = (async () => {
      const status = await rawRequest<PermissionCheckStatus>(account, 'GET', '/api/system/permissions');

      if (status.blocked) {
        const secretFiles = status.unsafe.filter(u => u.severity === 'secret');
        await confirmAndFix(account, secretFiles);
        return;
      }

      const warnings = status.unsafe.filter(u => u.severity === 'general');
      if (warnings.length > 0 && !warningsPrinted) {
        warningsPrinted = true;
        console.error('Warning: some Routerly configuration files have unsafe permissions:');
        printUnsafeFiles(warnings);
      }
    })();
  }
  await permissionCheck;
}

async function rawRequest<T>(
  account: AccountEntry,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${account.serverUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${account.token}`,
      // ponytail: only set Content-Type when there is a body; Fastify rejects empty JSON bodies
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as unknown as T;

  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    // Some routes answer with a machine code plus a sentence (`label_taken` +
    // "Label ... is already used"); the sentence is the one worth printing.
    const body = data as { error?: string; message?: string };
    throw new ApiError(res.status, body.message ?? body.error ?? res.statusText);
  }

  return data as T;
}

async function request<T>(
  account: AccountEntry,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const exempt = PERMISSION_EXEMPT_PATHS.has(path);
  if (!exempt) await ensurePermissionsSafe(account);

  try {
    return await rawRequest<T>(account, method, path, body);
  } catch (err) {
    // Defensive: a race between the pre-check above and this call could flip
    // the guard from safe to unsafe. Re-run the prompt/fix flow, then retry once.
    if (!exempt && err instanceof ApiError && err.status === 423) {
      permissionCheck = null;
      await ensurePermissionsSafe(account);
      return rawRequest<T>(account, method, path, body);
    }
    throw err;
  }
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
