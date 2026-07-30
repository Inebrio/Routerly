import { randomUUID } from 'node:crypto';
import type { ProjectConfig, RoutingPolicy, RoutingProfile } from '@routerly/shared';
import { readConfig } from '../../config/loader.js';
import { BUILTIN_PROFILES, getBuiltin } from './presets.js';

/**
 * Profile resolution + resolve-time default-profile migration.
 *
 * No destructive rewrite of projects.json happens anywhere here. A project
 * with no profileId and existing policies keeps being served by an
 * ephemeral 'default' profile built on the fly from those policies,
 * reproducing today's routing exactly. Resolving twice yields identical
 * output: that is the entire "migration".
 * // ponytail: migration is resolve-time, not a data rewrite; zero-risk, reversible
 */

/** Deep-clones a RoutingPolicy array so no caller can mutate a frozen preset's policies. */
function clonePolicies(policies: RoutingPolicy[]): RoutingPolicy[] {
  return structuredClone(policies);
}

/**
 * Resolves the RoutingProfile a project should use.
 *
 * Priority: user-overlay profile matching project.profileId, then a
 * built-in matching project.profileId, then the ephemeral 'default'
 * profile derived from the project's own (legacy) policies.
 */
export async function resolveProfile(project: ProjectConfig): Promise<RoutingProfile> {
  if (project.profileId) {
    const userProfiles = await readConfig('profiles');
    const userProfile = userProfiles.find(p => p.id === project.profileId);
    if (userProfile) {
      return { ...userProfile, policies: clonePolicies(userProfile.policies) };
    }
    const builtin = getBuiltin(project.profileId);
    if (builtin) {
      return { ...builtin, policies: clonePolicies(builtin.policies) };
    }
  }

  const balanced = getBuiltin('balanced')!;
  return {
    ...balanced,
    policies: clonePolicies(project.policies ?? balanced.policies),
    builtin: false,
    id: 'default',
    baseId: 'balanced',
    version: 1,
  };
}

/** Deep clone of a built-in preset into a new user profile, ready to persist as an overlay. */
export function cloneProfile(baseId: string, label: string): RoutingProfile {
  const builtin = getBuiltin(baseId);
  if (!builtin) throw new Error(`unknown_builtin_profile: ${baseId}`);
  return {
    ...builtin,
    id: randomUUID(),
    version: 1,
    label,
    builtin: false,
    baseId,
    policies: clonePolicies(builtin.policies),
  };
}

/** Bumps a user profile's version on edit. Does not persist, callers still writeConfig(). */
export function bumpVersion(profile: RoutingProfile): RoutingProfile {
  return { ...profile, version: profile.version + 1 };
}

/** Built-in presets followed by user overlays. Built-ins are deep-cloned, never the live frozen refs. */
export async function listProfiles(): Promise<RoutingProfile[]> {
  const builtins = BUILTIN_PROFILES.map(p => ({ ...p, policies: clonePolicies(p.policies) }));
  const userProfiles = await readConfig('profiles');
  return [...builtins, ...userProfiles];
}

/**
 * Write guard for any future profile write path (Task 9). Rejects persisting
 * a profile marked builtin, or reusing a built-in's id as a same-id override.
 * Throws exactly `immutable_builtin_profile`; later error handling matches on it.
 */
export function assertWritableProfile(profile: RoutingProfile): void {
  if (profile.builtin === true || BUILTIN_PROFILES.some(b => b.id === profile.id)) {
    throw new Error('immutable_builtin_profile');
  }
}
