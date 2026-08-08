import { PASSTHROUGH_MODEL_ID, type RouterKind } from '@routerly/shared';

export interface ValidatePassthroughModelsParams {
  /** Resolved kind the router is being saved as (already defaulted to 'router' by the caller if absent). */
  kind: RouterKind;
  /** The model list as it will be stored — already normalized by the caller (api.ts) for the resolved kind. */
  models: { modelId: string; prompt?: string }[] | undefined;
}

/**
 * Validates a passthrough-kind router's model list carries exactly one
 * pass-through entry (`modelId === PASSTHROUGH_MODEL_ID`), alongside zero or
 * more real `RouterModelRef`s. Returns the status/message to send as
 * `{ error: message }`, or `null` when valid (or `kind !== 'passthrough'`,
 * where no pseudo-entry check applies here — the caller strips any sentinel
 * from non-passthrough submissions before this runs).
 */
export function validatePassthroughModels(
  params: ValidatePassthroughModelsParams,
): { status: number; message: string } | null {
  const { kind, models } = params;
  if (kind !== 'passthrough') return null;

  const count = (models ?? []).filter((m) => m.modelId === PASSTHROUGH_MODEL_ID).length;

  if (count === 0) {
    return { status: 400, message: "A passthrough router's model list must include the pass-through entry" };
  }
  if (count > 1) {
    return { status: 400, message: 'A passthrough router can have only one pass-through entry' };
  }

  return null;
}
