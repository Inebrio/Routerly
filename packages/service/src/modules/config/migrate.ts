/**
 * Startup migration: legacy guardrails + PII shapes → new per-rule block/log + policies shapes.
 *
 * Old guardrails: top-level `action: 'block'|'log'|'warn'|'flag'` + optional `fallbackMessage`.
 * New guardrails: `block?/log?/blockMessage?` per rule; no top-level action.
 *
 * Old PII flat: `scrubInput?`, `scrubOutput?`, `entities?`, `customPatterns?` at top level.
 * New PII: `{ policies: PiiPolicy[] }` where each policy has `target`.
 *
 * Runs once per startup on every stored project. Idempotent.
 */
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';
import type { ProjectConfig, GuardrailConfig, PiiConfig, GuardrailRule, PiiPolicy, Settings, UsageRecord } from '@routerly/shared';
import { readConfig, writeConfig } from './loader.js';
import { CONFIG_PATHS } from '../../lib/paths.js';

// Legacy shapes (only what we need to detect/convert — not exported to callers)
interface LegacyGuardrailConfig {
  action?: string;
  fallbackMessage?: string;
  detectInjection?: boolean;
  rules: Array<Record<string, unknown>>;
}

interface LegacyPiiConfig {
  scrubInput?: boolean;
  scrubOutput?: boolean;
  entities?: string[];
  customPatterns?: string[];
  policies?: Array<Record<string, unknown>>;
}

function migrateGuardrailAction(action: string | undefined): { block?: boolean; log?: boolean } {
  switch (action) {
    case 'block': return { block: true };
    case 'log':
    case 'warn':
    case 'flag': return { log: true };
    default: return {};
  }
}

function migrateGuardrails(raw: unknown): GuardrailConfig | undefined {
  // ponytail: caller (migrateProjectConfigs) guards with truthiness; null/non-object never reaches here
  const legacy = raw as LegacyGuardrailConfig;
  // Already migrated if no top-level action
  if (legacy.action === undefined && legacy.fallbackMessage === undefined) {
    return raw as GuardrailConfig;
  }
  const { block, log } = migrateGuardrailAction(legacy.action);
  const rules: GuardrailRule[] = (legacy.rules ?? []).map((r) => {
    const rule = { ...r } as unknown as Record<string, unknown>;
    // Only set block/log if the rule doesn't already have them
    if (rule['block'] === undefined && rule['log'] === undefined) {
      if (block) rule['block'] = true;
      if (log) rule['log'] = true;
    }
    delete rule['action'];
    return rule as unknown as GuardrailRule;
  });
  const result: GuardrailConfig = { rules };
  if (legacy.detectInjection !== undefined) result.detectInjection = legacy.detectInjection;
  // fallbackMessage → blockMessage on each rule (only when rule has block: true and no blockMessage)
  if (legacy.fallbackMessage) {
    for (const rule of result.rules) {
      const r = rule as unknown as Record<string, unknown>;
      if (r['block'] === true && r['blockMessage'] === undefined) {
        r['blockMessage'] = legacy.fallbackMessage;
      }
    }
  }
  return result;
}

function migratePii(raw: unknown): PiiConfig | undefined {
  // ponytail: caller (migrateProjectConfigs) guards with truthiness; null/non-object never reaches here
  const legacy = raw as LegacyPiiConfig;
  // Already migrated: has policies array, no top-level scrubInput/scrubOutput
  if (legacy.policies && legacy.scrubInput === undefined && legacy.scrubOutput === undefined) {
    // Check if policies themselves need migration (old scrubInput/scrubOutput on policies)
    const needsPolicyMigration = legacy.policies.some(
      (p) => (p['scrubInput'] !== undefined || p['scrubOutput'] !== undefined),
    );
    if (!needsPolicyMigration) return raw as PiiConfig;
    // Migrate policy-level scrubInput/scrubOutput → target
    const migratedPolicies: PiiPolicy[] = legacy.policies.map((p) => migratePolicy(p));
    return { policies: migratedPolicies };
  }
  // Top-level flat PII: synthesize a single "default" policy
  const policies: PiiPolicy[] = [];
  if (legacy.policies?.length) {
    for (const p of legacy.policies) {
      policies.push(migratePolicy(p));
    }
  } else {
    // Build from flat fields
    const scrubIn = legacy.scrubInput === true;
    const scrubOut = legacy.scrubOutput === true;
    const target = scrubIn && scrubOut ? 'both' : scrubOut ? 'response' : 'request';
    const policy: PiiPolicy = { target };
    // ponytail: legacy had PII fully off (both scrub flags false) → keep it off, don't silently activate request scrub
    if (!scrubIn && !scrubOut) policy.enabled = false;
    if (legacy.entities?.length) policy.entities = legacy.entities as NonNullable<PiiPolicy['entities']>;
    if (legacy.customPatterns?.length) policy.customPatterns = legacy.customPatterns;
    policies.push(policy);
  }
  return { policies };
}

function migratePolicy(raw: Record<string, unknown>): PiiPolicy {
  const p = { ...raw };
  if (p['target'] === undefined) {
    const scrubIn = p['scrubInput'] === true;
    const scrubOut = p['scrubOutput'] === true;
    p['target'] = scrubIn && scrubOut ? 'both' : scrubOut ? 'response' : 'request';
    // ponytail: both legacy flags false = policy was off; preserve that instead of defaulting to active 'request'
    if (!scrubIn && !scrubOut && p['enabled'] === undefined) p['enabled'] = false;
  }
  delete p['scrubInput'];
  delete p['scrubOutput'];
  return p as unknown as PiiPolicy;
}

/** Settings keys dropped from the Settings type. Stored files keep them forever
 * otherwise: readConfig returns the file as-is and PUT /api/settings spreads the
 * current object, so a removed key is never overwritten away. */
const REMOVED_SETTINGS_KEYS = ['defaultTimeoutMs'];

export async function migrateSettings(): Promise<string[]> {
  const settings = await readConfig('settings') as unknown as Record<string, unknown>;
  const stale = REMOVED_SETTINGS_KEYS.filter((key) => key in settings);
  if (stale.length === 0) return [];
  for (const key of stale) delete settings[key];
  await writeConfig('settings', settings as unknown as Settings);
  return stale;
}

export async function migrateProjectConfigs(): Promise<number> {
  const projects = await readConfig('projects') as ProjectConfig[];
  let count = 0;
  const updated = projects.map((project) => {
    const raw = project as unknown as Record<string, unknown>;
    let changed = false;

    const newGuardrails = raw['guardrails'] ? migrateGuardrails(raw['guardrails']) : undefined;
    if (newGuardrails && JSON.stringify(newGuardrails) !== JSON.stringify(raw['guardrails'])) {
      raw['guardrails'] = newGuardrails;
      changed = true;
    }

    const newPii = raw['pii'] ? migratePii(raw['pii']) : undefined;
    if (newPii && JSON.stringify(newPii) !== JSON.stringify(raw['pii'])) {
      raw['pii'] = newPii;
      changed = true;
    }

    if (changed) count++;
    return raw as unknown as ProjectConfig;
  });

  if (count > 0) {
    await writeConfig('projects', updated);
  }
  return count;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * One-time migration: legacy usage.json (a single JSON array) -> usage.ndjson
 * (one JSON object per line). RTR-06.
 *
 * Idempotent (EC4: usage.ndjson already present -> no-op). Count-verified
 * (AC5: the written NDJSON is read back and its line count compared against
 * the source array length before it is ever published). Throws loudly on a
 * corrupted legacy file (EC2) instead of silently discarding data — and the
 * legacy file is only ever renamed to `.migrated`, never deleted, so a
 * migration that never completes always leaves the original data recoverable
 * on disk.
 */
export async function migrateUsageToNdjson(): Promise<number> {
  // EC4: NDJSON already present -> already migrated.
  try {
    await access(CONFIG_PATHS.usage);
    return 0;
  } catch {
    // ENOENT (or any stat failure) -> proceed, ndjson not present yet.
  }

  let raw: string;
  try {
    raw = await readFile(CONFIG_PATHS.usageLegacyJson, 'utf-8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return 0; // fresh install, nothing to migrate
    throw err;
  }

  const trimmed = raw.trim();
  // EC1: empty legacy file -> zero records, no error.
  // EC2: malformed JSON throws here (SyntaxError) and propagates to the caller.
  const records = (trimmed ? JSON.parse(trimmed) : []) as unknown;
  if (!Array.isArray(records)) {
    throw new Error('usage.json is corrupted: expected a JSON array of usage records');
  }
  const usageRecords = records as UsageRecord[];

  const tmpPath = `${CONFIG_PATHS.usage}.migrate-tmp`;
  const content = usageRecords.length
    ? usageRecords.map((r) => JSON.stringify(r)).join('\n') + '\n'
    : '';
  await writeFile(tmpPath, content, 'utf-8');

  // AC5: read the just-written file back and verify the line count matches
  // the source array length exactly before publishing over the target.
  const writtenRaw = await readFile(tmpPath, 'utf-8');
  const writtenLineCount = writtenRaw.split('\n').filter((l) => l.length > 0).length;
  if (writtenLineCount !== usageRecords.length) {
    await unlink(tmpPath).catch(() => {});
    throw new Error(
      `usage migration line-count mismatch: expected ${usageRecords.length}, wrote ${writtenLineCount}`,
    );
  }

  await rename(tmpPath, CONFIG_PATHS.usage);
  // Safety net: retire the old file, never delete it outright.
  await rename(CONFIG_PATHS.usageLegacyJson, `${CONFIG_PATHS.usageLegacyJson}.migrated`);

  return usageRecords.length;
}
