import type { Profile, ProjectConfig } from '@routerly/shared';
import { readConfig, writeConfig } from '../../config/loader.js';

/**
 * Brings profile data up to the multi-kind shape.
 *
 * Two rewrites, both shape-detecting so they converge from any older version
 * and are a no-op once done:
 *  - projects: `profileId` -> `routingProfileId`, since a project now binds one
 *    profile per kind and an unqualified name would be ambiguous.
 *  - profiles: overlays written before profiles had kinds were all routing
 *    overlays, so they get `kind: 'routing'`.
 *
 * `balanced` is rewritten to `auto`, the preset that replaced it: identical
 * policies, selector and fallback strategy, so routing is unchanged. Any other
 * retired preset id is left alone and stays resolvable as a legacy built-in.
 */

const RENAMED_PRESETS: Record<string, string> = { balanced: 'auto' };

/** Returns how many records were rewritten, projects and overlays together. */
export async function migrateProfiles(): Promise<number> {
  let changed = 0;

  const projects = await readConfig('projects');
  const migratedProjects = projects.map((project: ProjectConfig) => {
    const legacyId = project.profileId;
    if (legacyId === undefined) return project;
    changed++;
    const { profileId: _dropped, ...rest } = project;
    const target = RENAMED_PRESETS[legacyId] ?? legacyId;
    // An explicit routingProfileId already wins: it can only come from a newer
    // write, which is by definition the intended one.
    return { ...rest, routingProfileId: rest.routingProfileId ?? target };
  });
  if (changed > 0) await writeConfig('projects', migratedProjects);

  const profilesBefore = changed;
  // Read as the pre-kind shape: on disk an overlay written by an older version
  // has no `kind` at all, which the current Profile type cannot express.
  const profiles = (await readConfig('profiles')) as (Omit<Profile, 'kind'> & { kind?: string })[];
  const migratedProfiles = profiles.map(profile => {
    if (profile.kind !== undefined) return profile as Profile;
    changed++;
    const baseId = profile.baseId;
    return {
      ...profile,
      kind: 'routing',
      ...(baseId !== undefined && RENAMED_PRESETS[baseId] ? { baseId: RENAMED_PRESETS[baseId] } : {}),
    } as Profile;
  });
  if (changed > profilesBefore) await writeConfig('profiles', migratedProfiles);

  return changed;
}
