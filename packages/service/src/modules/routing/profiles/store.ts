import { randomUUID } from 'node:crypto';
import type {
  OptimizerProfile,
  Profile,
  ProfileKind,
  ProjectConfig,
  RoutingProfile,
  SecurityProfile,
} from '@routerly/shared';
import { readConfig } from '../../config/loader.js';
import { BUILTIN_PROFILES, DEFAULT_PROFILE_ID, getBuiltin, listBuiltins } from './presets.js';

/**
 * Profile resolution for the three profile kinds.
 *
 * A project either points at a profile (built-in preset or user overlay) or
 * carries its own inline config. The inline case is reported as an ephemeral
 * profile with id `custom`, so callers have one shape to handle and nothing in
 * projects.json ever needs rewriting to introduce profiles.
 * // ponytail: inline config stays where it is, wrapped at read time, not migrated
 */

/** Id of the ephemeral profile that wraps a project's own inline config. */
export const CUSTOM_PROFILE_ID = 'custom';

/** Looks a profile up among user overlays first, then the built-in presets (current or legacy). */
async function findProfile(id: string): Promise<Profile | undefined> {
  const overlays = await readConfig('profiles');
  return overlays.find(p => p.id === id) ?? getBuiltin(id);
}

/**
 * Resolves an id to a profile of the expected kind. A mismatched kind is treated
 * as unresolved: an id can only ever have been written by the wrong surface, and
 * silently applying an optimizer profile as routing config would be worse.
 */
async function resolveOfKind<T extends Profile>(
  id: string | undefined,
  kind: T['kind'],
): Promise<T | undefined> {
  if (!id) return undefined;
  const found = await findProfile(id);
  return found?.kind === kind ? (structuredClone(found) as T) : undefined;
}

/**
 * Resolves the routing profile a project should use.
 *
 * Unlike the other two kinds, routing always yields a profile: a project with
 * neither a profile nor policies still has to be routed, and falls back to the
 * default preset.
 */
export async function resolveRoutingProfile(project: ProjectConfig): Promise<RoutingProfile> {
  const bound = await resolveOfKind<RoutingProfile>(
    project.routingProfileId ?? project.profileId,
    'routing',
  );
  if (bound) return bound;

  const fallback = getBuiltin(DEFAULT_PROFILE_ID.routing) as RoutingProfile;
  return {
    ...structuredClone(fallback),
    id: CUSTOM_PROFILE_ID,
    label: 'Custom',
    builtin: false,
    baseId: fallback.id,
    version: 1,
    policies: structuredClone(project.policies ?? fallback.policies),
  };
}

/** Resolves the optimizer profile, or undefined when the project runs no optimizers. */
export async function resolveOptimizerProfile(
  project: ProjectConfig,
): Promise<OptimizerProfile | undefined> {
  const bound = await resolveOfKind<OptimizerProfile>(project.optimizerProfileId, 'optimizer');
  if (bound) return bound;
  if (!project.optimizers) return undefined;
  return {
    id: CUSTOM_PROFILE_ID,
    kind: 'optimizer',
    version: 1,
    label: 'Custom',
    builtin: false,
    optimizers: structuredClone(project.optimizers),
  };
}

/** Resolves the security profile, or undefined when the project has no guardrails and no PII config. */
export async function resolveSecurityProfile(
  project: ProjectConfig,
): Promise<SecurityProfile | undefined> {
  const bound = await resolveOfKind<SecurityProfile>(project.securityProfileId, 'security');
  if (bound) return bound;
  if (!project.guardrails && !project.pii) return undefined;
  return {
    id: CUSTOM_PROFILE_ID,
    kind: 'security',
    version: 1,
    label: 'Custom',
    builtin: false,
    guardrails: structuredClone(project.guardrails ?? { rules: [] }),
    pii: structuredClone(project.pii ?? { policies: [] }),
  };
}

/**
 * Returns the project as the request pipeline should see it: inline optimizer
 * and security config replaced by whatever the bound profiles say.
 *
 * Done once, at the edge, so every downstream consumer keeps reading
 * `project.optimizers` / `project.guardrails` / `project.pii` unchanged.
 * Routing is not folded in here: the router resolves its own profile because it
 * needs the selector and fallback strategy too, not just the policies.
 */
export async function applyProfiles(project: ProjectConfig): Promise<ProjectConfig> {
  if (!project.optimizerProfileId && !project.securityProfileId) return project;
  const [optimizer, security] = await Promise.all([
    resolveOptimizerProfile(project),
    resolveSecurityProfile(project),
  ]);
  return {
    ...project,
    ...(optimizer ? { optimizers: optimizer.optimizers } : {}),
    ...(security ? { guardrails: security.guardrails, pii: security.pii } : {}),
  };
}

/** Deep clone of a preset or overlay into a new user profile, ready to persist. */
export async function cloneProfile(baseId: string, label: string): Promise<Profile> {
  const base = await findProfile(baseId);
  if (!base) throw new Error(`unknown_base_profile: ${baseId}`);
  return {
    ...structuredClone(base),
    id: randomUUID(),
    version: 1,
    label,
    builtin: false,
    baseId,
  };
}

/** Bumps a user profile's version on edit. Does not persist, callers still writeConfig(). */
export function bumpVersion<T extends Profile>(profile: T): T {
  return { ...profile, version: profile.version + 1 };
}

/**
 * Built-in presets followed by user overlays, optionally narrowed to one kind.
 * Built-ins are deep-cloned, never the live frozen refs.
 */
export async function listProfiles(kind?: ProfileKind): Promise<Profile[]> {
  const builtins = (kind ? listBuiltins(kind) : BUILTIN_PROFILES).map(p => structuredClone(p));
  const overlays = await readConfig('profiles');
  return [...builtins, ...overlays.filter(p => !kind || p.kind === kind)];
}

/**
 * Write guard for every profile write path. Rejects persisting a profile marked
 * builtin, reusing a built-in's id as a same-id override, or squatting on the
 * ephemeral custom id. Throws exactly `immutable_builtin_profile`; error
 * handling upstream matches on it.
 */
export function assertWritableProfile(profile: Profile): void {
  if (
    profile.builtin === true ||
    profile.id === CUSTOM_PROFILE_ID ||
    getBuiltin(profile.id) !== undefined
  ) {
    throw new Error('immutable_builtin_profile');
  }
}
