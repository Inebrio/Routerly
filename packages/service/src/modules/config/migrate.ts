/**
 * Startup migration: legacy guardrails + PII shapes → new per-rule block/log + policies shapes.
 *
 * Old guardrails: top-level `action: 'block'|'log'|'warn'|'flag'` + optional `fallbackMessage`.
 * New guardrails: `block?/log?/blockMessage?` per rule; no top-level action.
 *
 * Old PII flat: `scrubInput?`, `scrubOutput?`, `entities?`, `customPatterns?` at top level.
 * New PII: `{ policies: PiiPolicy[] }` where each policy has `target`.
 *
 * Runs once per startup on every stored router. Idempotent.
 */
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { RouterConfig, GuardrailConfig, PiiConfig, GuardrailRule, PiiPolicy, Settings, UsageRecord } from '@routerly/shared';
import { PASSTHROUGH_MODEL_ID } from '@routerly/shared';
import { readConfig, writeConfig } from './loader.js';
import { CONFIG_PATHS } from '../../lib/paths.js';

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * One-time storage migration: config/projects.json → config/routers.json (RTR-01).
 *
 * `projects` was removed from `CONFIG_PATHS`/`StoredTypeMap` entirely, so the
 * legacy file is read directly at its historical path instead of through
 * `readConfig`. Idempotent (EC1): if `routers.json` already exists, this is a
 * no-op — it is only ever created by this function or by a later
 * `writeConfig('routers', …)`, so its presence means the migration (or a
 * fresh install) already happened. If `projects.json` is also absent, there
 * is nothing to migrate — a fresh install never creates it (AC2). If
 * `projects.json` exists but fails to parse as JSON or is not an array, this
 * throws rather than starting the service on partial data (EC3). An empty
 * array migrates to an empty `routers.json` with no error (EC2).
 *
 * Returns the number of routers migrated, or `undefined` when nothing was
 * done (already migrated, or no legacy file ever existed).
 */
export async function migrateRouterStorage(): Promise<number | undefined> {
  try {
    await readFile(CONFIG_PATHS.routers, 'utf-8');
    return undefined; // routers.json already exists — migrated already (EC1)
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }

  const legacyPath = join(CONFIG_PATHS.config, 'projects.json');
  let raw: string;
  try {
    raw = await readFile(legacyPath, 'utf-8');
  } catch (err) {
    if (isEnoent(err)) return undefined; // fresh install: nothing to migrate (AC2)
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot migrate ${legacyPath}: file is not valid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Cannot migrate ${legacyPath}: expected an array, got ${typeof parsed}`);
  }

  await writeConfig('routers', parsed as RouterConfig[]);
  return parsed.length;
}

/**
 * Rewrites custom roles' legacy `'project:read'`/`'project:write'` permission
 * strings to `'router:read'`/`'router:write'` (RTR-01). Built-in roles are
 * code, not data — nothing to migrate for them. Read/write as loosely-typed
 * records: the legacy strings are no longer part of the `Permission` union,
 * so a stored role predating this migration cannot type-check as `RoleConfig`
 * until it is rewritten. Write-back only when something actually changed.
 * Returns the number of roles rewritten.
 */
export async function migrateRolePermissions(): Promise<number> {
  const roles = await readConfig('roles') as unknown as Array<Record<string, unknown> & { permissions: string[] }>;
  let count = 0;
  const updated = roles.map((role) => {
    let roleChanged = false;
    const permissions = role.permissions.map((p) => {
      if (p === 'project:read') { roleChanged = true; return 'router:read'; }
      if (p === 'project:write') { roleChanged = true; return 'router:write'; }
      return p;
    });
    if (roleChanged) count++;
    return roleChanged ? { ...role, permissions } : role;
  });
  if (count > 0) await writeConfig('roles', updated as unknown as Awaited<ReturnType<typeof readConfig<'roles'>>>);
  return count;
}

/**
 * Renames the `projectId` key to `routerId` on every stored usage record
 * (RTR-01). Idempotent: skipped when the first record already lacks
 * `projectId`. Returns the number of records rewritten.
 */
export async function migrateUsageRouterId(): Promise<number> {
  const usage = await readConfig('usage') as unknown as Array<Record<string, unknown>>;
  if (usage.length === 0 || !('projectId' in usage[0]!)) return 0;
  let count = 0;
  const updated = usage.map((record) => {
    if (!('projectId' in record)) return record;
    const { projectId, ...rest } = record;
    count++;
    return { ...rest, routerId: projectId };
  });
  await writeConfig('usage', updated as unknown as Awaited<ReturnType<typeof readConfig<'usage'>>>);
  return count;
}

/**
 * Renames the `projectIds` scoping field to `routerIds` on every notification
 * channel that has it (RTR-01). Channels live nested under
 * `settings.notifications.channels`, not in a top-level file of their own.
 * Idempotent: a channel with no `projectIds` key is left untouched. Returns
 * the number of channels rewritten.
 */
export async function migrateNotificationChannelScope(): Promise<number> {
  const settings = await readConfig('settings') as unknown as Record<string, unknown>;
  const notifications = settings['notifications'] as { channels?: Array<Record<string, unknown>> } | undefined;
  const channels = notifications?.channels;
  if (!channels || channels.length === 0) return 0;
  let count = 0;
  for (const channel of channels) {
    if ('projectIds' in channel) {
      channel['routerIds'] = channel['projectIds'];
      delete channel['projectIds'];
      count++;
    }
  }
  if (count > 0) await writeConfig('settings', settings as unknown as Settings);
  return count;
}

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
  const routers = await readConfig('routers') as RouterConfig[];
  let count = 0;
  const updated = routers.map((router) => {
    const raw = router as unknown as Record<string, unknown>;
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
    return raw as unknown as RouterConfig;
  });

  if (count > 0) {
    await writeConfig('routers', updated);
  }
  return count;
}

/**
 * One-time migration: an Orchestrator's `candidates[]` used to carry an explicit
 * numeric `weight` per candidate, used only to break scoring ties; array order now
 * carries that same priority signal (index 0 = highest), same pattern as a Router's
 * own `policies[]`. For each `kind: 'orchestrator'` router whose candidates still
 * carry a `weight` property, stable-sorts its candidates descending by stored weight
 * (AC5: order among equal weights is preserved from the stored array — deterministic,
 * reproducible on a second run) and strips `weight` from each. Missing weight sorts
 * as `-Infinity` for the comparison only; `weight: 0` sorts as literal `0` — both land
 * below any positive weight, without error (AC6). Routers with 0 or 1 candidates are
 * left unchanged (EC1/EC2 — nothing to order). Non-orchestrator routers and
 * orchestrators with no legacy `weight` property are returned unchanged. Idempotent:
 * after the one write-back, no candidate carries `weight`, so a second run detects
 * nothing to do. Returns the number of orchestrator routers migrated.
 */
export async function migrateOrchestratorCandidateOrder(): Promise<number> {
  const routers = await readConfig('routers') as RouterConfig[];
  let count = 0;
  const updated = routers.map((router) => {
    const raw = router as unknown as Record<string, unknown>;
    if (raw['kind'] !== 'orchestrator') return router;
    const candidates = raw['candidates'] as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length <= 1) return router;
    const hasLegacyWeight = candidates.some((c) => 'weight' in c);
    if (!hasLegacyWeight) return router;

    const weightOf = (c: Record<string, unknown>): number =>
      typeof c['weight'] === 'number' ? c['weight'] : -Infinity;
    const reordered = candidates
      .map((c, index) => ({ c, index }))
      .sort((a, b) => weightOf(b.c) - weightOf(a.c) || a.index - b.index)
      .map(({ c }) => {
        const { weight: _weight, ...rest } = c;
        return rest;
      });

    count++;
    return { ...raw, candidates: reordered } as unknown as RouterConfig;
  });

  if (count > 0) {
    await writeConfig('routers', updated);
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

/**
 * Inserts the pinned pass-through entry into every pre-existing
 * passthrough-kind router's `models[]` (PR-D). Before this change,
 * `validatePassthroughModels` rejected any non-empty model list on a
 * passthrough router, so every one stored before now has `models: []`.
 * Idempotent: a router whose `models` already contains
 * `{ modelId: PASSTHROUGH_MODEL_ID }` is left untouched, so a second run is a
 * no-op. Non-passthrough routers are never touched. Returns the number of
 * routers changed.
 */
export async function migratePassthroughPseudoModel(): Promise<number> {
  const routers = await readConfig('routers');
  let count = 0;
  const updated = routers.map((router) => {
    if (router.kind !== 'passthrough') return router;
    if (router.models.some((m) => m.modelId === PASSTHROUGH_MODEL_ID)) return router;
    count++;
    return { ...router, models: [{ modelId: PASSTHROUGH_MODEL_ID }, ...router.models] };
  });
  if (count > 0) await writeConfig('routers', updated);
  return count;
}
