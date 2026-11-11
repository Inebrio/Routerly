import { PASSTHROUGH_MODEL_ID, type PassthroughException, type RouterKind } from '@routerly/shared';

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

export interface ValidatePassthroughExceptionsParams {
  kind: RouterKind;
  /** The model list as it will be stored (sentinel included for passthrough). */
  models: { modelId: string }[] | undefined;
  /** The exception list as it will be stored (the body's, or the stored one when the body omits it). */
  exceptions: PassthroughException[] | undefined;
}

/**
 * Validates a passthrough router's exception rules: only on `passthrough`,
 * every target one of the router's real models (never the sentinel), no
 * duplicate `match`. Indexes in messages are 0-based.
 */
export function validatePassthroughExceptions(
  params: ValidatePassthroughExceptionsParams,
): { status: number; message: string } | null {
  const { kind, models, exceptions } = params;
  if (!exceptions?.length) return null;
  if (kind !== 'passthrough') {
    return { status: 400, message: 'Exceptions are only supported on passthrough routers' };
  }
  const real = new Set((models ?? []).map((m) => m.modelId).filter((id) => id !== PASSTHROUGH_MODEL_ID));
  const seen = new Set<string>();
  for (const [i, rule] of exceptions.entries()) {
    if (!real.has(rule.targetModelId)) {
      return { status: 400, message: `Exception #${i}: target "${rule.targetModelId}" is not a model of this router` };
    }
    if (seen.has(rule.match)) {
      return { status: 400, message: `Exception #${i}: duplicate match "${rule.match}"` };
    }
    seen.add(rule.match);
  }
  return null;
}
