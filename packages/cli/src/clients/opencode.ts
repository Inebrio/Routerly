/**
 * OpenCode client integration.
 *
 * Research (verified against the live OpenCode docs on 2026-07-30,
 * `opencode.ai/docs/config/` and `opencode.ai/docs/providers/`, not
 * training memory):
 * - Config file: `~/.config/opencode/opencode.json` (global). OpenCode also
 *   supports a per-project `opencode.json` and `OPENCODE_CONFIG`/
 *   `OPENCODE_CONFIG_DIR` env overrides; this integration uses the global
 *   path, the same precedent as the Claude Code and Codex integrations
 *   (`~/.claude/settings.json`, `~/.codex/config.toml`).
 * - Format: JSON (JSONC is also accepted by OpenCode, but this integration
 *   writes plain JSON), schema `https://opencode.ai/config.json`.
 * - Custom OpenAI-compatible provider structure, confirmed verbatim from the
 *   docs:
 *   ```json
 *   {
 *     "$schema": "https://opencode.ai/config.json",
 *     "provider": {
 *       "routerly": {
 *         "npm": "@ai-sdk/openai-compatible",
 *         "name": "Routerly",
 *         "options": { "baseURL": "<serverUrl>/v1", "apiKey": "<token>" },
 *         "models": { "routerly/ada": { "name": "Routerly (auto-routed)" } }
 *       }
 *     }
 *   }
 *   ```
 * - `apiKey` is a plain JSON string field. The docs show `"{env:VAR}"` as one
 *   supported syntax for referencing an environment variable, but the field
 *   itself accepts any literal string. This integration writes the literal
 *   token value directly, same as the Claude Code and Codex integrations, to
 *   keep this client's `supportState: 'auto-configurable'` promise of a
 *   one-command setup with no manual env-var export step.
 * - Provider id: `"routerly"`, not `"openai"`. The docs don't explicitly
 *   forbid reusing a built-in id but recommend a distinct one to avoid
 *   conflicting with OpenCode's built-in providers; this also avoids
 *   embedding any reserved competitor name/URL.
 * - `models` is a required object with at least one entry per the docs (no
 *   auto-discovery documented for custom providers). This integration writes
 *   one entry keyed `"routerly/ada"`, Routerly's reserved auto-routing
 *   sentinel model id (see `VIRTUAL_MODEL` in
 *   `packages/service/src/modules/routing/policies/model-preference.ts` and
 *   the `adaPlaceholder` advertised by
 *   `packages/service/src/modules/api-reverse-proxy/openai.ts`'s
 *   `GET /v1/models`). Selecting it in OpenCode's model picker sends the
 *   literal string `"routerly/ada"`, which the model-preference routing
 *   policy recognizes and abstains on (scores every real candidate equally,
 *   letting other policies route), instead of an arbitrary label scored as
 *   a request for a nonexistent specific model. The actual model string
 *   OpenCode sends is forwarded verbatim by Routerly regardless of this
 *   label, this is a client-side label, not payload synthesis, so it does
 *   not violate wire-format transparency.
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

const META = CLIENT_REGISTRY.find((c) => c.id === 'opencode')!;

const CONFIG_SCHEMA = 'https://opencode.ai/config.json';

function getConfigPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

function toV1BaseUrl(serverUrl: string): string {
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

async function getOpencodeVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFile('opencode', ['--version']);
    const version = stdout.trim();
    return version || undefined;
  } catch {
    return undefined;
  }
}

/** Reads the config file and returns its parsed JSON, or `{}` if missing/malformed. */
async function readConfig(filePath: string): Promise<{ raw: string; json: Record<string, unknown> }> {
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

function extractRouterlyBaseUrl(json: Record<string, unknown>): string | undefined {
  const provider = (json.provider && typeof json.provider === 'object' ? json.provider : {}) as Record<
    string,
    unknown
  >;
  const routerly = (provider.routerly && typeof provider.routerly === 'object' ? provider.routerly : undefined) as
    | { options?: unknown }
    | undefined;
  const options = (routerly?.options && typeof routerly.options === 'object' ? routerly.options : undefined) as
    | { baseURL?: unknown }
    | undefined;
  return typeof options?.baseURL === 'string' ? options.baseURL : undefined;
}

async function detect(): Promise<DetectResult> {
  const configPath = getConfigPath();
  const configExists = await pathExists(configPath);
  const version = await getOpencodeVersion();
  return {
    installed: configExists || version !== undefined,
    configPath,
    configExists,
    ...(version !== undefined ? { version } : {}),
  };
}

async function inspect(): Promise<InspectResult> {
  const configPath = getConfigPath();
  const { raw, json } = await readConfig(configPath);
  const exists = raw !== '';
  const currentBaseUrl = extractRouterlyBaseUrl(json);
  const routerlyConfigured = currentBaseUrl !== undefined;

  let stale = false;
  if (routerlyConfigured) {
    // Non-throwing lookup: inspect() is a read-only status check and must
    // not kill the process just because no account is active.
    const account = await getCurrentAccount();
    if (account) {
      stale = currentBaseUrl !== toV1BaseUrl(account.serverUrl);
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
  const { raw: before, json } = await readConfig(filePath);

  const existingProvider = (json.provider && typeof json.provider === 'object' ? json.provider : {}) as Record<
    string,
    unknown
  >;
  const provider = {
    ...existingProvider,
    routerly: {
      npm: '@ai-sdk/openai-compatible',
      name: 'Routerly',
      options: {
        baseURL: toV1BaseUrl(target.baseUrl),
        apiKey: target.token,
      },
      models: {
        'routerly/ada': { name: 'Routerly (auto-routed)' },
      },
    },
  };
  const merged = { ...json, $schema: CONFIG_SCHEMA, provider };
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
    throw new Error('OpenCode CLI (`opencode`) is not installed or not on PATH.');
  }
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('opencode', [], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

export const opencodeIntegration: ClientIntegration = {
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
