/**
 * Continue client integration.
 *
 * Research (verified against the live Continue docs on 2026-07-30, not
 * training memory):
 * - Config file: `~/.continue/config.yaml` (macOS/Linux; the Windows path
 *   `%USERPROFILE%\.continue\config.yaml` is out of scope, same precedent as
 *   the Claude Code integration: no existing Windows-path handling elsewhere
 *   in this codebase to extend). The older `config.json` is deprecated; this
 *   integration does not target it.
 * - Format: YAML. Required top-level keys: `name`, `version`, `schema: v1`,
 *   plus a `models` array.
 * - Confirmed verbatim custom OpenAI-compatible model entry shape:
 *   ```yaml
 *   name: My Config
 *   version: 0.0.1
 *   schema: v1
 *
 *   models:
 *     - name: <label>
 *       provider: openai
 *       model: <model id>
 *       apiBase: http://localhost:8000/v1
 *       apiKey: <literal key>
 *   ```
 * - `apiKey` is a plain literal string field (confirmed, not a
 *   secret-reference syntax). This integration writes the real token
 *   directly, same as the Claude Code/Codex/OpenCode integrations, to keep
 *   this client's `supportState: 'auto-configurable'` promise of a
 *   one-command setup with no manual step.
 * - `model` field: this integration writes `routerly/ada`, Routerly's
 *   reserved auto-routing sentinel model id (see `VIRTUAL_MODEL` in
 *   `packages/service/src/modules/routing/policies/model-preference.ts` and
 *   the `adaPlaceholder` advertised by
 *   `packages/service/src/modules/api-reverse-proxy/openai.ts`'s
 *   `GET /v1/models`), same convention `opencode.ts` uses.
 *
 * No YAML library is a dependency anywhere in this monorepo (same situation
 * `codex.ts` documents for TOML). This integration hand-rolls a minimal
 * line-based merge of the `models:` array, not a real YAML parser; see the
 * `parseModelsSection`/`mergeYaml` ponytail comments below for the ceiling.
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

const META = CLIENT_REGISTRY.find((c) => c.id === 'continue')!;

const MODEL_MARKER = 'model: routerly/ada';
const MODELS_KEY_RE = /^models:\s*$/;
const ITEM_START_RE = /^(\s*)-\s/;
const DEFAULT_HEADER_LINES = ['name: Routerly', 'version: 0.0.1', 'schema: v1'];

function getConfigPath(): string {
  return join(homedir(), '.continue', 'config.yaml');
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

/** Reads the config file's raw bytes, or `''` if missing. */
async function readRaw(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function trimTrailingBlank(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length && copy[copy.length - 1]!.trim() === '') copy.pop();
  return copy;
}

interface ModelsSection {
  /** Lines from the start of the file through (and including) the `models:` line. */
  headerLines: string[];
  hasModelsKey: boolean;
  /** Each existing `models:` array entry, as its raw lines (including the leading `- `). */
  itemBlocks: string[][];
  /** Lines after the last array item (next top-level key(s), or nothing). */
  trailingLines: string[];
  /** Indent used before `- ` in existing items, `'  '` (2 spaces) if the array is empty/new. */
  itemIndent: string;
}

// ponytail: minimal string-based YAML `models:` array extraction, not a real
// parser (doesn't handle flow-style arrays, multi-line scalars, or comments
// inside the array). Upgrade to a real YAML parser if Continue's config
// grows beyond a flat list of models entries.
function parseModelsSection(raw: string): ModelsSection {
  const lines = raw.length ? raw.split('\n') : [];
  const modelsIdx = lines.findIndex((line) => MODELS_KEY_RE.test(line));
  if (modelsIdx === -1) {
    return { headerLines: lines, hasModelsKey: false, itemBlocks: [], trailingLines: [], itemIndent: '  ' };
  }

  let i = modelsIdx + 1;
  const itemBlocks: string[][] = [];
  let current: string[] | undefined;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\S/.test(line)) break; // next top-level key, unindented
    if (ITEM_START_RE.test(line)) {
      current = [line];
      itemBlocks.push(current);
    } else if (current) {
      current.push(line);
    }
    i++;
  }

  const firstItemIndentMatch = itemBlocks[0]?.[0]?.match(ITEM_START_RE);
  const itemIndent = firstItemIndentMatch ? firstItemIndentMatch[1]! : '  ';

  return {
    headerLines: lines.slice(0, modelsIdx + 1),
    hasModelsKey: true,
    itemBlocks,
    trailingLines: lines.slice(i),
    itemIndent,
  };
}

function findRoutedlyBlock(section: ModelsSection): string[] | undefined {
  return section.itemBlocks.find((block) => block.some((line) => line.includes(MODEL_MARKER)));
}

function extractApiBase(block: string[] | undefined): string | undefined {
  if (!block) return undefined;
  for (const line of block) {
    const match = line.match(/apiBase:\s*(\S+)\s*$/);
    if (match) return match[1];
  }
  return undefined;
}

function buildRoutedlyBlock(indent: string, target: ConfigTarget): string[] {
  const contIndent = `${indent}  `;
  return [
    `${indent}- name: Routerly (auto-routed)`,
    `${contIndent}provider: openai`,
    `${contIndent}model: routerly/ada`,
    `${contIndent}apiBase: ${toV1BaseUrl(target.baseUrl)}`,
    `${contIndent}apiKey: ${target.token}`,
  ];
}

/**
 * Merges the Routerly model entry into the `models:` array of an existing
 * config.yaml body, preserving every other key/entry. Matches our own entry
 * across re-plans by the `model: routerly/ada` marker line, not position, so
 * re-planning with a new target replaces rather than duplicates it.
 */
function mergeYaml(raw: string, target: ConfigTarget): string {
  const section = parseModelsSection(raw);
  const block = buildRoutedlyBlock(section.itemIndent, target);

  if (!section.hasModelsKey) {
    const header = section.headerLines.length ? trimTrailingBlank(section.headerLines) : DEFAULT_HEADER_LINES;
    const lines = [...header, '', 'models:', ...block];
    return `${lines.join('\n')}\n`;
  }

  const ourIdx = section.itemBlocks.findIndex((existingBlock) => existingBlock.some((line) => line.includes(MODEL_MARKER)));
  const items = [...section.itemBlocks];
  if (ourIdx === -1) {
    items.push(block);
  } else {
    items[ourIdx] = block;
  }

  const lines = [...section.headerLines, ...items.flat(), ...trimTrailingBlank(section.trailingLines)];
  return `${trimTrailingBlank(lines).join('\n')}\n`;
}

async function detect(): Promise<DetectResult> {
  const configPath = getConfigPath();
  const configExists = await pathExists(configPath);
  // ponytail: no binary/extension presence probe (unlike claude-code.ts /
  // codex.ts / opencode.ts, which shell out to a CLI `--version`). Continue
  // is primarily a VS Code/JetBrains extension; this task's research step
  // only independently verified the config file/schema, not a specific CLI
  // binary name, so `installed` is driven solely by config file presence
  // rather than asserting an unverified binary name.
  return {
    installed: configExists,
    configPath,
    configExists,
  };
}

async function inspect(): Promise<InspectResult> {
  const configPath = getConfigPath();
  const raw = await readRaw(configPath);
  const exists = raw !== '';
  const section = parseModelsSection(raw);
  const currentBaseUrl = extractApiBase(findRoutedlyBlock(section));
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
  const before = await readRaw(filePath);
  const after = mergeYaml(before, target);
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

// ponytail: no `launch()`. Unlike claude-code/codex/opencode, Continue has
// no independently-verified standalone CLI binary this task's research
// covered (it's primarily a VS Code/JetBrains extension); omitted rather
// than guessing a binary name to spawn.
export const continueIntegration: ClientIntegration = {
  id: META.id,
  label: META.label,
  supportState: META.supportState,
  detect,
  inspect,
  plan,
  apply,
  validate,
  rollback,
};

/**
 * Cline client integration.
 *
 * Research (verified against the live Cline docs on 2026-07-30, not
 * training memory): Cline (a VS Code extension) is configured entirely
 * through the extension's own settings UI (gear icon panel: Base URL / API
 * Key / Model ID fields). There is no stable standalone config file on disk
 * meant for direct editing, unlike Continue's `~/.continue/config.yaml`.
 * This rules out an `auto-configurable` promise: there is no file this CLI
 * could safely back up, edit, and roll back. `supportState: 'documented'`
 * instead: the registry entry and docs page exist, but `apply()` always
 * rejects, directing the user to configure Cline by hand.
 *
 * `detect()`/`inspect()` are best-effort. Cline is a VS Code extension, not
 * a standalone binary, so there is no `cline --version` to shell out to
 * (unlike claude-code.ts/codex.ts/opencode.ts). The one locally-checkable
 * signal is whether the extension is installed in VS Code, via
 * `code --list-extensions`, matched against Cline's real marketplace
 * extension id `saoudrizwan.claude-dev`. If the `code` binary itself isn't
 * on PATH (VS Code not installed, or CLI shell command not set up), this
 * conservatively reports `installed: false` rather than guessing.
 */
const CLINE_META = CLIENT_REGISTRY.find((c) => c.id === 'cline')!;
const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

async function clineExtensionPresent(): Promise<boolean> {
  try {
    const { stdout } = await execFile('code', ['--list-extensions']);
    return stdout
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .includes(CLINE_EXTENSION_ID);
  } catch {
    return false;
  }
}

async function clineDetect(): Promise<DetectResult> {
  const installed = await clineExtensionPresent();
  return {
    installed,
    configPath: null,
    configExists: false,
  };
}

async function clineInspect(): Promise<InspectResult> {
  // No file to read; conservatively report "not configured" rather than
  // inventing a signal. configPath here is the docs-reference hint from the
  // registry, not a real file this integration reads or writes.
  return {
    configPath: CLINE_META.configPathHint,
    exists: false,
    routerlyConfigured: false,
    stale: false,
  };
}

function clineNotAutoConfigurableError(): Error {
  return new Error(
    `Cline is not auto-configurable: it is configured through the extension's settings UI ` +
      `(gear icon panel: Base URL / API Key / Model ID), not a standalone file this CLI can ` +
      `safely edit. See docs: ${CLINE_META.docSlug}`
  );
}

async function clinePlan(_target: ConfigTarget): Promise<ConfigPlan> {
  throw clineNotAutoConfigurableError();
}

async function clineApply(_configPlan: ConfigPlan): Promise<ApplyResult> {
  throw clineNotAutoConfigurableError();
}

async function clineValidate(): Promise<ValidateResult> {
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

async function clineRollback(backupId: string): Promise<void> {
  await restoreBackup(backupId);
}

export const clineIntegration: ClientIntegration = {
  id: CLINE_META.id,
  label: CLINE_META.label,
  supportState: CLINE_META.supportState,
  detect: clineDetect,
  inspect: clineInspect,
  plan: clinePlan,
  apply: clineApply,
  validate: clineValidate,
  rollback: clineRollback,
};
