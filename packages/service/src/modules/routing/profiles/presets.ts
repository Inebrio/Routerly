import type {
  OptimizerProfile,
  Profile,
  ProfileKind,
  RoutingPolicy,
  RoutingProfile,
  SecurityProfile,
} from '@routerly/shared';

/**
 * Built-in profile presets, for all three profile kinds.
 *
 * These are code constants, never persisted to profiles.json and never
 * written through writeConfig(). Users customize a preset by cloning it
 * into a profiles.json overlay, not by mutating these objects. Because they
 * are code, a Routerly release can improve a preset and every project bound
 * to it picks the improvement up.
 */

function policies(...types: RoutingPolicy['type'][]): RoutingPolicy[] {
  return types.map(type => ({ type, enabled: true }));
}

// ponytail: presets are code constants, never persisted; clone-to-customize handles edits
const ROUTING_PRESETS = Object.freeze([
  Object.freeze({
    id: 'auto',
    kind: 'routing',
    version: 1,
    label: 'Auto',
    policies: policies('health', 'performance', 'cheapest', 'capability'),
    selector: 'argmax',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
  Object.freeze({
    id: 'cheap',
    kind: 'routing',
    version: 1,
    label: 'Cheap',
    policies: policies('cheapest', 'budget-remaining', 'health'),
    selector: 'cheapest',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
  Object.freeze({
    id: 'fast',
    kind: 'routing',
    version: 1,
    label: 'Fast',
    policies: policies('performance', 'health'),
    selector: 'lowest-latency',
    fallbackStrategy: 'retry-after-cooldown',
    builtin: true,
  }),
  Object.freeze({
    id: 'coding',
    kind: 'routing',
    version: 1,
    label: 'Coding',
    policies: policies('capability', 'model-preference', 'performance', 'health'),
    selector: 'argmax',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
]) as readonly RoutingProfile[];

/**
 * Optimizer presets grouped by reversibility class (see optimizers/README.md):
 * lossless = session-dedup, headroom; recoverable = ccr, rtk; lossy =
 * relevance, caveman, llmlingua-2. The three tiers are cumulative, so moving
 * up a tier only ever adds steps.
 */
const OPTIMIZER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'optimizer-safe',
    kind: 'optimizer',
    version: 1,
    label: 'Safe',
    optimizers: {
      steps: [
        { id: 'session-dedup', enabled: true },
        { id: 'headroom', enabled: true },
      ],
    },
    builtin: true,
  }),
  Object.freeze({
    id: 'optimizer-balanced',
    kind: 'optimizer',
    version: 1,
    label: 'Balanced',
    optimizers: {
      steps: [
        { id: 'session-dedup', enabled: true },
        { id: 'headroom', enabled: true },
        { id: 'ccr', enabled: true },
        { id: 'rtk', enabled: true },
      ],
    },
    builtin: true,
  }),
  Object.freeze({
    id: 'optimizer-aggressive',
    kind: 'optimizer',
    version: 1,
    label: 'Aggressive',
    optimizers: {
      steps: [
        { id: 'session-dedup', enabled: true },
        { id: 'headroom', enabled: true },
        { id: 'ccr', enabled: true },
        { id: 'rtk', enabled: true },
        { id: 'relevance', enabled: true },
        { id: 'llmlingua-2', enabled: true },
      ],
    },
    builtin: true,
  }),
]) as readonly OptimizerProfile[];

const PII_ENTITIES = ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'] as const;

/**
 * Security presets stay model-free on purpose. Topic and moderation guardrails
 * need a judge model id, which is instance-specific: a preset that named one
 * would be broken on every install but the one it was written on. Users who
 * want a judge clone a preset and pick their model.
 */
const SECURITY_PRESETS = Object.freeze([
  Object.freeze({
    id: 'security-standard',
    kind: 'security',
    version: 1,
    label: 'Standard',
    guardrails: { detectInjection: true, rules: [] },
    pii: { policies: [{ target: 'request', entities: [...PII_ENTITIES] }] },
    builtin: true,
  }),
  Object.freeze({
    id: 'security-strict',
    kind: 'security',
    version: 1,
    label: 'Strict',
    guardrails: { detectInjection: true, rules: [] },
    pii: { policies: [{ target: 'both', entities: [...PII_ENTITIES] }] },
    builtin: true,
  }),
]) as readonly SecurityProfile[];

export const BUILTIN_PROFILES: readonly Profile[] = Object.freeze([
  ...ROUTING_PRESETS,
  ...OPTIMIZER_PRESETS,
  ...SECURITY_PRESETS,
]);

/**
 * Presets that shipped in earlier versions and are no longer offered. They stay
 * resolvable so a project still pointing at one keeps routing exactly as before,
 * but they are not listed and cannot be picked or cloned from the UI.
 *
 * `balanced` is byte-identical to `auto`, which replaced it; projects referencing
 * it are rewritten to `auto` by the routing module's migration. `offline` has no
 * equivalent among the current presets, so it survives here untouched.
 */
export const LEGACY_BUILTIN_PROFILES: readonly Profile[] = Object.freeze([
  Object.freeze({
    id: 'balanced',
    kind: 'routing',
    version: 1,
    label: 'Balanced',
    policies: policies('health', 'performance', 'cheapest', 'capability'),
    selector: 'argmax',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
  Object.freeze({
    id: 'offline',
    kind: 'routing',
    version: 1,
    label: 'Offline',
    policies: policies('health', 'cheapest'),
    selector: 'round-robin',
    fallbackStrategy: 'abort',
    builtin: true,
  }),
]) as readonly Profile[];

/** The preset a project falls back to when it has neither a profile nor custom config of that kind. */
export const DEFAULT_PROFILE_ID: Record<ProfileKind, string> = {
  routing: 'auto',
  optimizer: 'optimizer-safe',
  security: 'security-standard',
};

/** Resolves a preset by id, current or legacy. Legacy ids resolve but are never listed. */
export function getBuiltin(id: string): Profile | undefined {
  return BUILTIN_PROFILES.find(p => p.id === id) ?? LEGACY_BUILTIN_PROFILES.find(p => p.id === id);
}

/** The presets offered for a kind. Legacy presets are deliberately excluded. */
export function listBuiltins(kind: ProfileKind): readonly Profile[] {
  return BUILTIN_PROFILES.filter(p => p.kind === kind);
}
