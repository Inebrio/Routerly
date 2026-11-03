/**
 * Claude Code client integration.
 *
 * Research (verified against the live Claude Code docs on 2026-07-30, not
 * training memory; see task-5 brief for the fetch):
 * - Global settings file: `~/.claude/settings.json` (JSON). Windows path
 *   (`%USERPROFILE%\.claude\settings.json`) is out of scope: no existing
 *   Windows-path handling elsewhere in this codebase to extend.
 * - Environment variable overrides live under an `"env"` object in that file:
 *   `{ "env": { "KEY": "value", ... } }`.
 * - Base URL override: `ANTHROPIC_BASE_URL` (root URL, no `/v1` suffix).
 * - Auth: `ANTHROPIC_AUTH_TOKEN` (sends `Authorization: Bearer <token>`), not
 *   `ANTHROPIC_API_KEY` (sends `X-Api-Key`). Routerly's inbound auth
 *   (`packages/service/src/modules/api-reverse-proxy/anthropic.ts`,
 *   `extractRouterToken`) checks `Authorization: Bearer` first, and
 *   Routerly router tokens are bearer tokens, so `ANTHROPIC_AUTH_TOKEN` is the
 *   correct key, matching `docs/guides/claude-subscription.md`.
 */
import { readFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { CLIENT_REGISTRY } from '@routerly/shared';
import type {
  ClientIntegration,
  ConfigPlan,
  ConfigTarget,
  ApplyResult,
  DetectResult,
  InspectResult,
  ValidateResult,
} from './types.js';
import { backupFile, atomicWrite, restoreBackup } from '../lib/safe-file.js';
import { getCurrentAccount, requireAccount } from '../store.js';

const execFile = promisify(execFileCb);

const META = CLIENT_REGISTRY.find((c) => c.id === 'claude-code')!;

function getConfigPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getClaudeVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFile('claude', ['--version']);
    const version = stdout.trim();
    return version || undefined;
  } catch {
    return undefined;
  }
}

/** Reads the settings file and returns its parsed JSON, or `{}` if missing/malformed. */
async function readSettings(filePath: string): Promise<{ raw: string; json: Record<string, unknown> }> {
  let raw = '';
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { raw: '', json: {} };
  }
  if (!raw.trim()) return { raw, json: {} };
  try {
    return { raw, json: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    // Malformed JSON: treat as empty for merge purposes; `before` still
    // reflects the real on-disk bytes so the plan/backup is accurate.
    return { raw, json: {} };
  }
}

async function detect(): Promise<DetectResult> {
  const configPath = getConfigPath();
  const configExists = await pathExists(configPath);
  const version = await getClaudeVersion();
  return {
    installed: configExists || version !== undefined,
    configPath,
    configExists,
    ...(version !== undefined ? { version } : {}),
  };
}

async function inspect(): Promise<InspectResult> {
  const configPath = getConfigPath();
  const { raw, json } = await readSettings(configPath);
  const exists = raw !== '';
  const env = (json.env && typeof json.env === 'object' ? json.env : {}) as Record<string, unknown>;
  const currentBaseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : undefined;
  const routerlyConfigured = currentBaseUrl !== undefined;

  let stale = false;
  if (routerlyConfigured) {
    // Non-throwing lookup: inspect() is a read-only status check and must
    // not kill the process just because no account is active.
    const account = await getCurrentAccount();
    if (account) {
      stale = currentBaseUrl !== account.serverUrl.replace(/\/$/, '');
    }
  }

  return {
    configPath,
    exists,
    routerlyConfigured,
    stale,
    ...(currentBaseUrl !== undefined ? { currentBaseUrl } : {}),
  };
}

async function plan(target: ConfigTarget): Promise<ConfigPlan> {
  const filePath = getConfigPath();
  const { raw: before, json } = await readSettings(filePath);

  const existingEnv = (json.env && typeof json.env === 'object' ? json.env : {}) as Record<string, unknown>;
  const env = {
    ...existingEnv,
    ANTHROPIC_BASE_URL: target.baseUrl.replace(/\/$/, ''),
    ANTHROPIC_AUTH_TOKEN: target.token,
  };
  const merged = { ...json, env };
  const after = `${JSON.stringify(merged, null, 2)}\n`;

  return { clientId: META.id, filePath, before, after, backupId: randomUUID() };
}

async function apply(configPlan: ConfigPlan): Promise<ApplyResult> {
  await mkdir(dirname(configPlan.filePath), { recursive: true });
  await backupFile(META.id, configPlan.filePath, configPlan.backupId);
  await atomicWrite(configPlan.filePath, configPlan.after);
  return { backupId: configPlan.backupId, filePath: configPlan.filePath, ok: true };
}

async function validate(): Promise<ValidateResult> {
  const account = await requireAccount();
  const base = account.serverUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/health`);
    if (res.ok) {
      return { ok: true, reachable: true, message: `Routerly service reachable at ${base}` };
    }
    return { ok: false, reachable: true, message: `Routerly service at ${base} responded with status ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      message: `Routerly service unreachable at ${base}: ${(err as Error).message}`,
    };
  }
}

async function rollback(backupId: string): Promise<void> {
  await restoreBackup(backupId);
}

async function launch(): Promise<void> {
  const status = await detect();
  if (!status.installed) {
    throw new Error('Claude Code CLI (`claude`) is not installed or not on PATH.');
  }
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('claude', [], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

export const claudeCodeIntegration: ClientIntegration = {
  id: META.id,
  label: META.label,
  supportState: META.supportState,
  detect,
  inspect,
  plan,
  apply,
  validate,
  rollback,
  launch,
};
