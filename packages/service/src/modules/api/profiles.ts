import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Permission, Profile, ProfileKind } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { isModuleEnabled } from '../../core/modules/registry.js';
import { listProfiles, cloneProfile, bumpVersion, assertWritableProfile } from '../routing/profiles/store.js';
import { getBuiltin } from '../routing/profiles/presets.js';
import { guardrailConfigSchema, piiConfigSchema, optimizerConfigSchema } from './schemas.js';

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
 * Gates every profile handler on the 'profiles' module record. No
 * ModuleManifest/catalog entry exists for this id yet, so with no config record
 * isModuleEnabled defaults to true and nothing is disabled out of the box.
 */
async function checkProfilesModuleGate(reply: FastifyReply): Promise<boolean> {
  const records = await readConfig('modules');
  if (isModuleEnabled(records, 'profiles')) return true;
  reply.status(403).send({
    error: 'module_disabled',
    message: `profiles module is disabled`,
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

const profileKindSchema = z.enum(['routing', 'optimizer', 'security']);

const cloneSchema = z.object({
  baseId: z.string(),
  label: z.string().trim().min(1),
});

/**
 * Create schemas, one per kind. Everything but the label is optional: the
 * dashboard sends a full body, while a scripted client can post `{kind, label}`
 * and get an empty profile it fills in with PATCH.
 */
const CREATE_SCHEMAS = {
  routing: z.object({
    kind: z.literal('routing'),
    label: z.string().trim().min(1),
    policies: z.array(routingPolicySchema).default([]),
    selector: selectorTypeSchema.default('argmax'),
    fallbackStrategy: fallbackStrategyTypeSchema.default('next-best'),
  }),
  optimizer: z.object({
    kind: z.literal('optimizer'),
    label: z.string().trim().min(1),
    optimizers: optimizerConfigSchema.default({ steps: [] }),
  }),
  security: z.object({
    kind: z.literal('security'),
    label: z.string().trim().min(1),
    guardrails: guardrailConfigSchema.default({ rules: [] }),
    pii: piiConfigSchema.default({ policies: [] }),
  }),
} as const;

const createSchema = z.discriminatedUnion('kind', [
  CREATE_SCHEMAS.routing,
  CREATE_SCHEMAS.optimizer,
  CREATE_SCHEMAS.security,
]);

const labelField = { label: z.string().trim().min(1).optional() };

/**
 * One patch schema per kind: a routing profile has no optimizers to set and a
 * security profile has no selector, so validating them against a single union
 * of every field would accept nonsense.
 */
const PATCH_SCHEMAS: Record<ProfileKind, z.ZodTypeAny> = {
  routing: z.object({
    ...labelField,
    policies: z.array(routingPolicySchema).optional(),
    selector: selectorTypeSchema.optional(),
    fallbackStrategy: fallbackStrategyTypeSchema.optional(),
  }).refine(b => Object.keys(b).length > 0, { message: 'At least one field must be provided' }),
  optimizer: z.object({
    ...labelField,
    optimizers: optimizerConfigSchema.optional(),
  }).refine(b => Object.keys(b).length > 0, { message: 'At least one field must be provided' }),
  security: z.object({
    ...labelField,
    guardrails: guardrailConfigSchema.optional(),
    pii: piiConfigSchema.optional(),
  }).refine(b => Object.keys(b).length > 0, { message: 'At least one field must be provided' }),
};

/** Router field each kind binds to. Also the set of fields a delete has to check for use. */
const ROUTER_FIELD = {
  routing: 'routingProfileId',
  optimizer: 'optimizerProfileId',
  security: 'securityProfileId',
} as const;

const assignSchema = z.object({
  routing: z.string().nullable().optional(),
  optimizer: z.string().nullable().optional(),
  security: z.string().nullable().optional(),
}).refine(b => Object.keys(b).length > 0, { message: 'At least one kind must be provided' });

export const profilesRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════════
  // PROFILES (CRUD, all kinds)
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get<{ Querystring: { kind?: string } }>('/api/profiles', async (req, reply) => {
    if (!requirePerm(req, 'profiles:read', reply)) return;
    if (!await checkProfilesModuleGate(reply)) return;
    const kind = req.query.kind;
    if (kind !== undefined && !profileKindSchema.safeParse(kind).success) {
      return reply.status(400).send({ error: 'invalid_kind' });
    }
    return reply.send(await listProfiles(kind as ProfileKind | undefined));
  });

  fastify.post<{ Body: unknown }>('/api/profiles', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkProfilesModuleGate(reply)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const profile = { ...parsed.data, id: randomUUID(), version: 1, builtin: false } as Profile;
    const userProfiles = await readConfig('profiles');
    userProfiles.push(profile);
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:create', 'success', { id: profile.id, kind: profile.kind });
    return reply.status(201).send(profile);
  });

  fastify.post<{ Body: unknown }>('/api/profiles/clone', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkProfilesModuleGate(reply)) return;
    const parsed = cloneSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    let profile: Profile;
    try {
      profile = await cloneProfile(parsed.data.baseId, parsed.data.label.trim());
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const userProfiles = await readConfig('profiles');
    userProfiles.push(profile);
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:clone', 'success', { id: profile.id, kind: profile.kind, baseId: parsed.data.baseId });
    return reply.send(profile);
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/api/profiles/:id', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkProfilesModuleGate(reply)) return;

    const userProfiles = await readConfig('profiles');
    const idx = userProfiles.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
      if (getBuiltin(req.params.id)) return reply.status(409).send({ error: 'immutable_builtin_profile' });
      return reply.status(404).send({ error: 'Not found' });
    }
    const current = userProfiles[idx]!;
    const parsed = PATCH_SCHEMAS[current.kind].safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    // The schema for this kind already rejected every field that does not belong
    // to it, so the parsed body can be merged as-is.
    const updated = bumpVersion({ ...current, ...(parsed.data as Record<string, unknown>) } as Profile);
    assertWritableProfile(updated); // defensive - userProfiles entries are always builtin:false already
    userProfiles[idx] = updated;
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:update', 'success', { id: req.params.id, kind: current.kind });
    return reply.send(updated);
  });

  fastify.delete<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) => {
    if (!requirePerm(req, 'profiles:manage', reply)) return;
    if (!await checkProfilesModuleGate(reply)) return;

    const userProfiles = await readConfig('profiles');
    const idx = userProfiles.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
      if (getBuiltin(req.params.id)) return reply.status(409).send({ error: 'immutable_builtin_profile' });
      return reply.status(404).send({ error: 'Not found' });
    }
    const routers = await readConfig('routers');
    const inUse = routers.some(p =>
      Object.values(ROUTER_FIELD).some(field => p[field] === req.params.id) || p.profileId === req.params.id,
    );
    if (inUse) return reply.status(409).send({ error: 'profile_in_use' });

    userProfiles.splice(idx, 1);
    await writeConfig('profiles', userProfiles);
    audit(req, 'profile:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTER PROFILE ASSIGNMENT
  // ══════════════════════════════════════════════════════════════════════════

  fastify.put<{ Params: { id: string }; Body: unknown }>('/api/routers/:id/profiles', async (req, reply) => {
    if (!requirePerm(req, 'router:write', reply)) return;
    if (!await checkProfilesModuleGate(reply)) return;
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    const routers = await readConfig('routers');
    const idx = routers.findIndex(p => p.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });

    // exactOptionalPropertyTypes: clear by omitting the key, never by setting it
    // to undefined. profileId is the pre-0.4.0 name, dropped on any assignment so
    // a router cannot end up bound through two different fields.
    const { profileId: _legacy, ...router } = routers[idx]!;
    const next = { ...router };
    for (const kind of ['routing', 'optimizer', 'security'] as const) {
      const value = body[kind];
      if (value === undefined) continue;
      const field = ROUTER_FIELD[kind];
      if (value === null) {
        delete next[field];
        continue;
      }
      const available = await listProfiles(kind);
      if (!available.some(p => p.id === value)) {
        return reply.status(404).send({ error: 'profile_not_found', kind });
      }
      next[field] = value;
    }

    routers[idx] = next;
    await writeConfig('routers', routers);
    audit(req, 'router:profiles:update', 'success', { id: req.params.id, ...body });
    return reply.send({
      ...next,
      tokens: next.tokens?.map(t => ({ ...t, token: undefined })) || [],
    });
  });
};
