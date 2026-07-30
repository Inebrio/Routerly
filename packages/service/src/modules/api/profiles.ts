import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Permission, RoutingProfile } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { isModuleEnabled } from '../../core/modules/registry.js';
import { resolveProfile, listProfiles, cloneProfile, bumpVersion, assertWritableProfile } from '../routing/profiles/store.js';
import { getBuiltin } from '../routing/profiles/presets.js';
import { scoreCandidates } from '../routing/router.js';
import { SELECTOR_MAP } from '../routing/selectors/index.js';
import type { ScoredCandidate, SelectorContext } from '../routing/selectors/index.js';

// ── Route-local auth helpers (mirrors api.ts/connections.ts; no shared route-helper module exists) ──

function audit(req: FastifyRequest, action: string, result: AuditEntry['result'], details?: Record<string, unknown>): void {
  void logAudit({
    userId: req.dashUser?.id ?? 'unknown',
    email: req.dashUser?.email ?? 'unknown',
    endpoint: `${req.method} ${req.url}`,
    action,
    result,
    ...(details !== undefined ? { details } : {}),
  });
}

function requirePerm(req: FastifyRequest, perm: Permission, reply: FastifyReply): boolean {
  if (!req.dashUser?.permissions.includes(perm)) {
    reply.status(403).send({ error: 'Forbidden', message: `Required permission: ${perm}` });
    audit(req, perm, 'forbidden');
    return false;
  }
  return true;
}

/**
 * Gates the 6 routing-profile handlers on the 'routing-profiles' module record.
 * No ModuleManifest/catalog entry exists for this id yet (out of scope), so with no
 * config record isModuleEnabled defaults to true and nothing is disabled out of the box.
 */
async function checkRoutingProfilesModuleGate(reply: FastifyReply): Promise<boolean> {
  const records = await readConfig('modules');
  if (isModuleEnabled(records, 'routing-profiles')) return true;
  reply.status(403).send({
    error: 'module_disabled',
    message: `routing-profiles module is disabled`,
  });
  return false;
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const routingPolicySchema = z.object({
  type: z.enum(['context', 'cheapest', 'health', 'performance', 'llm', 'capability', 'rate-limit', 'fairness', 'budget-remaining', 'semantic-intent', 'model-preference']),
  enabled: z.boolean(),
  config: z.any().optional(),
});
const selectorTypeSchema = z.enum(['argmax', 'weighted-random', 'round-robin', 'cheapest', 'lowest-latency']);
const fallbackStrategyTypeSchema = z.enum(['next-best', 'retry-after-cooldown', 'abort']);

const cloneSchema = z.object({
  baseId: z.string(),
  label: z.string().trim().min(1),
});

const patchSchema = z.object({
  label: z.string().optional(),
  policies: z.array(routingPolicySchema).optional(),
  selector: selectorTypeSchema.optional(),
  fallbackStrategy: fallbackStrategyTypeSchema.optional(),
}).refine(b => b.label !== undefined || b.policies !== undefined || b.selector !== undefined || b.fallbackStrategy !== undefined, {
  message: 'At least one field must be provided',
});

const assignSchema = z.object({ profileId: z.string().nullable() });

const simulateSchema = z.object({
  profileId: z.string().optional(),
  policies: z.array(routingPolicySchema).optional(),
  selector: selectorTypeSchema.optional(),
  fallbackStrategy: fallbackStrategyTypeSchema.optional(),
  request: z.any(),
  projectId: z.string(),
});

export const profilesRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════════
  // ROUTING PROFILES (CRUD)
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/routing/profiles', async (req, reply) => {
    if (!requirePerm(req, 'profiles:read', reply)) return;
    if (!await checkRoutingProfilesModuleGate(reply)) return;
    return reply.send(await listProfiles());
  });

  fastify.post<{ Body: unknown }>('/api/routing/profiles/clone', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkRoutingProfilesModuleGate(reply)) return;
    const parsed = cloneSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    let profile: RoutingProfile;
    try {
      profile = cloneProfile(parsed.data.baseId, parsed.data.label.trim());
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const userProfiles = await readConfig('profiles');
    userProfiles.push(profile);
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:clone', 'success', { id: profile.id, baseId: parsed.data.baseId });
    return reply.send(profile);
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/api/routing/profiles/:id', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkRoutingProfilesModuleGate(reply)) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    const userProfiles = await readConfig('profiles');
    const idx = userProfiles.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
      if (getBuiltin(req.params.id)) return reply.status(409).send({ error: 'immutable_builtin_profile' });
      return reply.status(404).send({ error: 'Not found' });
    }
    const updated = bumpVersion({
      ...userProfiles[idx]!,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.policies !== undefined ? { policies: body.policies } : {}),
      ...(body.selector !== undefined ? { selector: body.selector } : {}),
      ...(body.fallbackStrategy !== undefined ? { fallbackStrategy: body.fallbackStrategy } : {}),
    });
    assertWritableProfile(updated); // defensive - userProfiles entries are always builtin:false already
    userProfiles[idx] = updated;
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:update', 'success', { id: req.params.id });
    return reply.send(updated);
  });

  fastify.delete<{ Params: { id: string } }>('/api/routing/profiles/:id', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkRoutingProfilesModuleGate(reply)) return;

    const userProfiles = await readConfig('profiles');
    const idx = userProfiles.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
      if (getBuiltin(req.params.id)) return reply.status(409).send({ error: 'immutable_builtin_profile' });
      return reply.status(404).send({ error: 'Not found' });
    }
    const projects = await readConfig('projects');
    if (projects.some(p => p.profileId === req.params.id)) {
      return reply.status(409).send({ error: 'profile_in_use' });
    }
    userProfiles.splice(idx, 1);
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PROJECT PROFILE ASSIGNMENT
  // ══════════════════════════════════════════════════════════════════════════

  fastify.put<{ Params: { id: string }; Body: unknown }>('/api/projects/:id/profile', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    if (!await checkRoutingProfilesModuleGate(reply)) return;
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    const projects = await readConfig('projects');
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    if (body.profileId !== null) {
      const profiles = await listProfiles();
      if (!profiles.some(p => p.id === body.profileId)) {
        return reply.status(404).send({ error: 'profile_not_found' });
      }
    }
    // exactOptionalPropertyTypes: clear by omitting the key, never by setting it to undefined.
    const { profileId: _prev, ...rest } = projects[idx]!;
    projects[idx] = body.profileId !== null ? { ...rest, profileId: body.profileId } : rest;
    await writeConfig('projects', projects);
    audit(req, 'project:profile:update', 'success', { id: req.params.id, profileId: body.profileId });
    return reply.send({
      ...projects[idx],
      tokens: projects[idx]!.tokens?.map(t => ({ ...t, token: undefined })) || []
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SIMULATE (dry-run - no upstream call, no usage recorded)
  // ══════════════════════════════════════════════════════════════════════════

  fastify.post<{ Body: unknown }>('/api/routing/simulate', async (req, reply) => {
    if (!requirePerm(req, 'profiles:read', reply)) return;
    if (!await checkRoutingProfilesModuleGate(reply)) return;
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    const projects = await readConfig('projects');
    const project = projects.find(p => p.id === body.projectId);
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const base = body.profileId
      ? await resolveProfile({ ...project, profileId: body.profileId })
      : await resolveProfile(project);
    const profile: RoutingProfile = {
      ...base,
      ...(body.policies !== undefined ? { policies: body.policies } : {}),
      ...(body.selector !== undefined ? { selector: body.selector } : {}),
      ...(body.fallbackStrategy !== undefined ? { fallbackStrategy: body.fallbackStrategy } : {}),
    };

    let sc;
    try {
      sc = await scoreCandidates(body.request, project, profile);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    if (sc.bypass) {
      const only = sc.bypass.models[0];
      return reply.send({
        picked: only?.model ?? null,
        ranked: only ? [{ model: only.model, score: 1, cost: undefined }] : [],
        trace: sc.bypass.trace,
      });
    }

    // Namespaced so round-robin's cursor (keyed by projectId in routingMemoryStore) never
    // collides with the live cursor router.ts advances for real requests on this project.
    const ctx: SelectorContext = { projectId: `simulate:${project.id}`, allAbstained: sc.allAbstained };
    const models = SELECTOR_MAP[profile.selector](sc.scored, ctx).models;
    const scoredByModel = new Map(sc.scored.map(c => [c.model, c]));
    const ranked = models.map(m => scoredByModel.get(m.model)).filter((c): c is ScoredCandidate => c !== undefined);
    return reply.send({
      picked: models[0]?.model ?? null,
      ranked,
      trace: sc.trace,
    });
  });
};
