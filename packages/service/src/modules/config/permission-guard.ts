import { stat, chmod } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import type { PermissionCheckStatus } from '@routerly/shared';
import { CONFIG_PATHS, type ConfigFile } from '../../lib/paths.js';

/**
 * RTR-04 — refuse to trust config files with unsafe permissions.
 *
 * Two-severity model, same threshold ssh applies to private keys: any file
 * holding plaintext secrets/credentials is hard-blocking when group-or-other
 * bits are set; everything else under CONFIG_PATHS is warn-only. `base`,
 * `config` and `data` are directories, not files, so they are never classified.
 */
export const SECRET_KEYS: readonly ConfigFile[] = ['secret', 'models', 'connections', 'routers', 'users'];
export const GENERAL_KEYS: readonly ConfigFile[] = [
  'settings', 'roles', 'modules', 'profiles', 'instances', 'experiments',
  'usage', 'notifications', 'audit', 'updateAnnouncement',
];

/** Any group-or-other bit (read/write/execute) set is unsafe. */
const UNSAFE_MASK = 0o077;

const BYPASS_ENV_VAR = 'ROUTERLY_SKIP_PERMISSION_CHECK';

export function isBypassActive(): boolean {
  return !!process.env[BYPASS_ENV_VAR];
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function severityOf(key: ConfigFile): 'secret' | 'general' {
  return (SECRET_KEYS as readonly string[]).includes(key) ? 'secret' : 'general';
}

/**
 * Fresh `fs.stat()` every call, no caching here — an external `chmod` between
 * two checks must be picked up without a restart (EC3). Missing file/dir is
 * treated as safe (EC1, first run). A stat that throws for any other reason
 * (e.g. no permission to even stat) is treated as unsafe — never silently
 * skipped (EC2).
 */
async function scanUnsafe(): Promise<PermissionCheckStatus['unsafe']> {
  const unsafe: PermissionCheckStatus['unsafe'] = [];
  for (const key of [...SECRET_KEYS, ...GENERAL_KEYS]) {
    const path = CONFIG_PATHS[key];
    const severity = severityOf(key);
    try {
      const info = await stat(path);
      const mode = info.mode & 0o777;
      if ((mode & UNSAFE_MASK) !== 0) {
        unsafe.push({ file: key, path, mode: mode.toString(8).padStart(3, '0'), severity });
      }
    } catch (err) {
      if (isEnoent(err)) continue; // EC1
      unsafe.push({ file: key, path, mode: 'unknown', severity }); // EC2
    }
  }
  return unsafe;
}

/**
 * Computes the current permission status. Bypass short-circuits to a safe,
 * non-blocking status — callers that skip a check/warning because of it are
 * responsible for logging that fact themselves (console.warn at startup
 * before the Fastify logger exists, fastify.log.warn inside request
 * handlers), every time, per the story's AC7.
 */
export async function checkPermissions(): Promise<PermissionCheckStatus> {
  if (isBypassActive()) {
    return { blocked: false, bypassActive: true, unsafe: [] };
  }
  const unsafe = await scanUnsafe();
  return { blocked: unsafe.some(u => u.severity === 'secret'), bypassActive: false, unsafe };
}

/**
 * Chmods every currently-unsafe file (secret and general both) to strip
 * group/other bits, and returns the CONFIG_PATHS keys actually changed.
 * Never called automatically just because bypass is active (EC5) — it is
 * only ever invoked after explicit operator confirmation.
 */
export async function fixPermissions(): Promise<string[]> {
  const unsafe = await scanUnsafe();
  const fixed: string[] = [];
  for (const entry of unsafe) {
    const key = entry.file as ConfigFile;
    try {
      const info = await stat(CONFIG_PATHS[key]);
      await chmod(CONFIG_PATHS[key], info.mode & 0o700);
      fixed.push(key);
    } catch (err) {
      if (isEnoent(err)) continue;
      throw err;
    }
  }
  return fixed;
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

/**
 * Startup guard (AC1-3): called right after `initConfigDirs()`, before the
 * port opens. Secrets-file permissions unsafe → refuse to start unless the
 * operator explicitly confirms a fix at an interactive prompt; never an
 * automatic silent fix, never a silent skip. Non-secret unsafe (AC4) →
 * warning only, startup proceeds. Bypass (AC7) skips the check entirely,
 * logged with console.warn (the Fastify logger does not exist yet).
 */
export async function enforceStartupGuard(): Promise<void> {
  if (isBypassActive()) {
    console.warn(`[permission-guard] ${BYPASS_ENV_VAR} is set — skipping startup permission check.`);
    return;
  }

  const status = await checkPermissions();
  const secretUnsafe = status.unsafe.filter(u => u.severity === 'secret');
  const generalUnsafe = status.unsafe.filter(u => u.severity === 'general');

  if (generalUnsafe.length > 0) {
    console.warn(
      `[permission-guard] Warning: unsafe permissions on general config file(s). Startup and requests still work; fix on the host filesystem when you can. Run: ${generalUnsafe.map(u => `chmod 600 ${u.path}`).join(' && ')}`,
    );
  }

  if (secretUnsafe.length === 0) return;

  console.error('[permission-guard] Refusing to trust unsafe permissions on secrets file(s):');
  for (const u of secretUnsafe) {
    console.error(`  ${u.path} (mode ${u.mode}) — group/other must have no access. Required action: chmod 600 (or stricter) on this file.`);
  }

  if (!process.stdin.isTTY) {
    console.error('[permission-guard] stdin is not a TTY (headless/container) — cannot prompt. Startup refused. Fix permissions manually and restart, or run with the confirm-and-fix prompt from an interactive terminal.');
    process.exit(1);
  }

  const confirmed = await promptYesNo('[permission-guard] Fix these permissions now? (y/N) ');
  if (!confirmed) {
    console.error('[permission-guard] Fix declined — startup refused. No changes were made.');
    process.exit(1);
  }

  const fixed = await fixPermissions();
  console.warn(`[permission-guard] Fixed permissions on: ${fixed.join(', ')}.`);
}
