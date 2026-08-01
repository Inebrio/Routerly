/**
 * Documented-only client integrations.
 *
 * Six registry entries have no writer and never will:
 *
 * - `cursor`, `generic-openai`, `generic-anthropic`: nothing on disk to edit.
 *   Cursor's base URL override lives in its own settings UI, the two generic
 *   entries are environment variables read by the official SDKs.
 * - `zed`, `openclaw`: their config files are JSON with comments. Parsing and
 *   re-serializing them would silently drop every comment the user wrote, so
 *   this CLI refuses to touch them rather than damaging a file it cannot
 *   round-trip.
 * - `claude-desktop`: it has no base URL override at all, its only Routerly
 *   surface is MCP, which is wired with an MCP token (`routerly mcp token
 *   create`) rather than a project token.
 *
 * They still get an integration so that `routerly clients list`/`inspect`
 * cover the whole registry and `configure` answers with the manual steps
 * instead of "Unknown client". `plan()`/`apply()` reject: a documented client
 * has no file this CLI could back up, write and roll back.
 */
import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_REGISTRY } from '@routerly/shared';
import type { ClientMeta } from '@routerly/shared';
import type {
  ClientIntegration,
  ConfigPlan,
  ConfigTarget,
  ApplyResult,
  DetectResult,
  InspectResult,
  ValidateResult,
} from './types.js';
import { restoreBackup } from '../lib/safe-file.js';
import { getCurrentAccount, requireAccount } from '../store.js';

/** Registry ids configured by hand, in registry order. */
export const MANUAL_CLIENT_IDS = [
  'claude-desktop',
  'openclaw',
  'cursor',
  'zed',
  'generic-openai',
  'generic-anthropic',
] as const;

/** Environment variable each generic SDK entry reads for its base URL. */
const ENV_BASE_URL_VAR: Record<string, string> = {
  'generic-openai': 'OPENAI_BASE_URL',
  'generic-anthropic': 'ANTHROPIC_BASE_URL',
};

/**
 * Expands the registry's `~/...` config hint into a real path. Hints that are
 * not file paths ("no file", UI-only clients) resolve to null.
 */
function resolveConfigPath(meta: ClientMeta): string | null {
  if (!meta.configPathHint.startsWith('~/')) return null;
  return join(homedir(), meta.configPathHint.slice(2));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function checkService(): Promise<ValidateResult> {
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

export function makeManualIntegration(id: string): ClientIntegration {
  const meta = CLIENT_REGISTRY.find((c) => c.id === id)!;

  async function detect(): Promise<DetectResult> {
    const configPath = resolveConfigPath(meta);
    const configExists = configPath !== null && (await pathExists(configPath));
    // No binary probe: none of these clients ships a CLI this integration
    // could version-check. Presence of the config file is the only local
    // signal, so a UI-only client always reports `installed: false`.
    return { installed: configExists, configPath, configExists };
  }

  async function inspect(): Promise<InspectResult> {
    const account = await getCurrentAccount();
    const envVar = ENV_BASE_URL_VAR[meta.id];
    if (envVar) {
      const currentBaseUrl = process.env[envVar];
      return {
        configPath: envVar,
        exists: currentBaseUrl !== undefined,
        routerlyConfigured: currentBaseUrl !== undefined,
        stale: Boolean(currentBaseUrl && account && !currentBaseUrl.startsWith(account.serverUrl.replace(/\/$/, ''))),
        ...(currentBaseUrl !== undefined ? { currentBaseUrl } : {}),
      };
    }

    const configPath = resolveConfigPath(meta);
    if (configPath === null) {
      return { configPath: meta.configPathHint, exists: false, routerlyConfigured: false, stale: false };
    }
    let raw = '';
    try {
      raw = await readFile(configPath, 'utf-8');
    } catch {
      return { configPath, exists: false, routerlyConfigured: false, stale: false };
    }
    // Best-effort signal only: the file is never parsed (it may carry
    // comments), so a mention of "routerly" is all this can honestly report.
    return {
      configPath,
      exists: true,
      routerlyConfigured: raw.toLowerCase().includes('routerly'),
      stale: false,
    };
  }

  function notAutoConfigurable(): Error {
    return new Error(
      `${meta.label} is configured by hand: run \`routerly clients configure ${meta.id}\` ` +
        `to print the exact steps, or see docs: ${meta.docSlug}`
    );
  }

  async function plan(_target: ConfigTarget): Promise<ConfigPlan> {
    throw notAutoConfigurable();
  }

  async function apply(_plan: ConfigPlan): Promise<ApplyResult> {
    throw notAutoConfigurable();
  }

  async function rollback(backupId: string): Promise<void> {
    await restoreBackup(backupId);
  }

  return {
    id: meta.id,
    label: meta.label,
    supportState: meta.supportState,
    detect,
    inspect,
    plan,
    apply,
    validate: checkService,
    rollback,
  };
}

export const MANUAL_INTEGRATIONS: ClientIntegration[] = MANUAL_CLIENT_IDS.map(makeManualIntegration);
