import type { Profile, RouterConfig } from '@routerly/shared';
import { readConfig, writeConfig } from '../../config/loader.js';

/**
 * Brings profile data up to the multi-kind shape.
 *
 * Two rewrites, both shape-detecting so they converge from any older version
 * and are a no-op once done:
 *  - routers: `profileId` -> `routingProfileId`, since a router now binds one
 *    profile per kind and an unqualified name would be ambiguous.
 *  - profiles: overlays written before profiles had kinds were all routing
 *    overlays, so they get `kind: 'routing'`.
 *
 * `balanced` is rewritten to `auto`, the preset that replaced it: identical
 * policies, selector and fallback strategy, so routing is unchanged. Any other
 * retired preset id is left alone and stays resolvable as a legacy built-in.
 *
 * The two security presets are the exception: they were deleted outright, not
 * retired, so a router still pointing at one has the dangling id stripped. The
 * router then runs with no guardrails and no PII policy, which is what "no
 * security profile" has always meant everywhere else.
 */

const RENAMED_PRESETS: Record<string, string> = { balanced: 'auto' };

/** Security presets that no longer exist. A router pointing at one is cleared. */
const DELETED_SECURITY_PRESETS = new Set(['security-standard', 'security-strict']);

/** Returns how many records were rewritten, routers and overlays together. */
export async function migrateProfiles(): Promise<number> {
  let changed = 0;

  const routers = await readConfig('routers');
  const migratedRouters = routers.map((router: RouterConfig) => {
    let next = router;

    if (next.securityProfileId !== undefined && DELETED_SECURITY_PRESETS.has(next.securityProfileId)) {
      changed++;
      const { securityProfileId: _gone, ...rest } = next;
      next = rest;
    }

    const legacyId = next.profileId;
    if (legacyId === undefined) return next;
    changed++;
    const { profileId: _dropped, ...rest } = next;
    const target = RENAMED_PRESETS[legacyId] ?? legacyId;
    // An explicit routingProfileId already wins: it can only come from a newer
    // write, which is by definition the intended one.
    return { ...rest, routingProfileId: rest.routingProfileId ?? target };
  });
  if (changed > 0) await writeConfig('routers', migratedRouters);

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
