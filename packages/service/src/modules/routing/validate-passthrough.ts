import type { RouterKind } from '@routerly/shared';

export interface ValidatePassthroughModelsParams {
  /** Resolved kind the router is being saved as (already defaulted to 'router' by the caller if absent). */
  kind: RouterKind;
  /** A passthrough router carries no model list — validated here so POST/PUT can't smuggle one in. */
  models: { modelId: string; prompt?: string }[] | undefined;
}

/**
 * Validates that a Passthrough router carries no model list at write time.
 * Returns the status/message to send as `{ error: message }`, or `null` when
 * valid (or `kind !== 'passthrough'`, where models are not read at all).
 */
export function validatePassthroughModels(
  params: ValidatePassthroughModelsParams,
): { status: number; message: string } | null {
  const { kind, models } = params;
  if (kind !== 'passthrough') return null;

  if (models && models.length > 0) {
    return { status: 400, message: 'A passthrough router cannot have models' };
  }

  return null;
}
