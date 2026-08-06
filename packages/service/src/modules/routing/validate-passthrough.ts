import type { RouterConfig, RouterKind } from '@routerly/shared';

export interface ValidatePassthroughSlugParams {
  /** Resolved kind the router is being saved as (already defaulted to 'router' by the caller if absent). */
  kind: RouterKind;
  slug: string | undefined;
  /** A passthrough router carries no model list — validated here so POST/PUT can't smuggle one in. */
  models: { modelId: string; prompt?: string }[] | undefined;
  /** Router list to validate against — the caller re-reads this immediately before the write (EC4). */
  routers: RouterConfig[];
  /** The router's own id. Present on PUT (enables the duplicate-slug self-exclusion); absent on POST — the id doesn't exist yet. */
  selfId?: string;
}

/**
 * Validates a Passthrough router's slug and model list at write time.
 * Returns the status/message to send as `{ error: message }`, or `null` when
 * valid (or `kind !== 'passthrough'`, where slug/models are not read at all).
 */
export function validatePassthroughSlug(
  params: ValidatePassthroughSlugParams,
): { status: number; message: string } | null {
  const { kind, slug, models, routers, selfId } = params;
  if (kind !== 'passthrough') return null;

  if (!slug || slug.trim().length === 0) {
    return { status: 400, message: 'A passthrough router needs a slug' };
  }

  if (models && models.length > 0) {
    return { status: 400, message: 'A passthrough router cannot have models' };
  }

  const duplicate = routers.some(
    (r) => r.kind === 'passthrough' && r.slug === slug && r.id !== selfId,
  );
  if (duplicate) {
    return { status: 409, message: `A passthrough router already uses slug "${slug}"` };
  }

  return null;
}
