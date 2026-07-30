/**
 * Codex CLI client integration.
 *
 * Research (verified against the live Codex CLI docs on 2026-07-30, not
 * training memory):
 * - Config file: `~/.codex/config.toml` (TOML).
 * - Top-level key `model_provider = "<id>"` selects the active provider. The
 *   id cannot be `openai`, `ollama`, or `lmstudio` (reserved); this
 *   integration uses `"routerly"`.
 * - Provider block: `[model_providers.routerly]` table with:
 *   - `name`: human-readable string.
 *   - `base_url`: the endpoint, Routerly's `<serverUrl>/v1` (confirmed live:
 *     `packages/service/src/modules/api-reverse-proxy/openai.ts` serves both
 *     `/v1/chat/completions` and `/v1/responses`).
 *   - `wire_api = "responses"`: Codex's native protocol, which Routerly
 *     supports.
 *   - One of three auth mechanisms: `env_key` (name of an env var Codex
 *     reads the key from at runtime; does not store the key value in the
 *     file), `auth` (command that outputs a token), or
 *     `experimental_bearer_token` (direct literal token string in the file,
 *     documented as "discouraged" but functional).
 *
 * Auth mechanism choice: `experimental_bearer_token` with the literal token
 * value, not `env_key`. This client's `ClientMeta.supportState` promise is
 * one-command auto-configured setup with no extra manual step; `env_key`
 * would require the user to separately `export` an environment variable
 * themselves, breaking that promise. `experimental_bearer_token` is the only
 * mechanism that writes the literal secret into the file, same as what the
 * Claude Code integration already does for `settings.json`
 * (`ANTHROPIC_AUTH_TOKEN` written as a literal value).
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

const META = CLIENT_REGISTRY.find((c) => c.id === 'codex')!;

const PROVIDER_HEADER = '[model_providers.routerly]';

function getConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

function toResponsesBaseUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/$/, '')}/v1`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getCodexVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFile('codex', ['--version']);
    const version = stdout.trim();
    return version || undefined;
  } catch {
    return undefined;
  }
}

/** Reads the config file's raw bytes, or `''` if missing. */
async function readRaw(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Extracts the `[model_providers.routerly]` table as a flat key/value map
 * (string values only; this integration only ever writes string fields).
 */
// ponytail: minimal string-based TOML block extraction, not a real parser
// (doesn't handle multi-line strings, arrays, inline tables, or nested
// sub-tables inside the routerly block). Upgrade to a real TOML parser if
// Codex config grows beyond flat string keys.
function extractProviderBlock(raw: string): Record<string, string> | undefined {
  const lines = raw.split('\n');
  const headerIdx = lines.findIndex((line) => line.trim() === PROVIDER_HEADER);
  if (headerIdx === -1) return undefined;

  const block: Record<string, string> = {};
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*(\w+)\s*=\s*"(.*)"\s*$/);
    if (match) block[match[1]!] = match[2]!;
  }
  return block;
}

/**
 * Merges the Routerly `model_provider` selector and `[model_providers.routerly]`
 * table into an existing config.toml body, preserving every other line
 * verbatim.
 */
// ponytail: minimal string-based TOML block insert/replace, not a real TOML
// parser (no TOML lib is a dependency anywhere in this monorepo). Doesn't
// handle arbitrary existing formatting/comments inside the routerly block
// or a `model_provider` key re-declared inside another table. Upgrade to a
// real TOML parser (e.g. `smol-toml`) if that becomes a problem.
function mergeToml(existing: string, target: ConfigTarget): string {
  const baseUrl = toResponsesBaseUrl(target.baseUrl);
  const lines = existing.length ? existing.split('\n') : [];

  // Strip any existing top-level `model_provider = ...` line; it's re-added below.
  const withoutSelector = lines.filter((line) => !/^model_provider\s*=/.test(line.trim()));

  // Strip any existing [model_providers.routerly] block: header line through
  // the line before the next `[`-starting header, or EOF.
  const rest: string[] = [];
  let skipping = false;
  for (const line of withoutSelector) {
    if (line.trim() === PROVIDER_HEADER) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*\[/.test(line)) {
      skipping = false;
    }
    if (skipping) continue;
    rest.push(line);
  }
  while (rest.length && rest[rest.length - 1]!.trim() === '') rest.pop();

  const providerBlock = [
    PROVIDER_HEADER,
    'name = "Routerly"',
    `base_url = "${baseUrl}"`,
    'wire_api = "responses"',
    // ponytail: experimental_bearer_token is Codex's officially-discouraged-
    // but-functional literal-token field; chosen over env_key to keep the
    // auto-configurable promise (no manual env-var export step). If Codex
    // removes this field, fall back to env_key + a documented manual export
    // step.
    `experimental_bearer_token = "${target.token}"`,
  ];

  const bodyLines = [
    'model_provider = "routerly"',
    ...(rest.length ? ['', ...rest] : []),
    '',
    ...providerBlock,
  ];
  return `${bodyLines.join('\n')}\n`;
}

async function detect(): Promise<DetectResult> {
  const configPath = getConfigPath();
  const configExists = await pathExists(configPath);
  const version = await getCodexVersion();
  return {
    installed: configExists || version !== undefined,
    configPath,
    configExists,
    ...(version !== undefined ? { version } : {}),
  };
}

async function inspect(): Promise<InspectResult> {
  const configPath = getConfigPath();
  const raw = await readRaw(configPath);
  const exists = raw !== '';
  const block = extractProviderBlock(raw);
  const currentBaseUrl = block?.base_url;
  const routerlyConfigured = currentBaseUrl !== undefined;

  let stale = false;
  if (routerlyConfigured) {
    // Non-throwing lookup: inspect() is a read-only status check and must
    // not kill the process just because no account is active.
    const account = await getCurrentAccount();
    if (account) {
      stale = currentBaseUrl !== toResponsesBaseUrl(account.serverUrl);
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
  const before = await readRaw(filePath);
  const after = mergeToml(before, target);
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
    throw new Error('Codex CLI (`codex`) is not installed or not on PATH.');
  }
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('codex', [], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

export const codexIntegration: ClientIntegration = {
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
