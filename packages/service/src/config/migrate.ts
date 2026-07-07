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
import type { ProjectConfig, GuardrailConfig, PiiConfig, GuardrailRule, PiiPolicy } from '@routerly/shared';
import { readConfig, writeConfig } from './loader.js';

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
    const policy: PiiPolicy = { name: 'default', target };
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
