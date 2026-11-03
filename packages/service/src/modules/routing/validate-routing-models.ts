import type { RoutingPolicy } from '@routerly/shared';
import { listEffectiveModelsIncludingDisabled } from '../provider/list-effective.js';

interface RoutingModelSource {
  routingModelId?: string | undefined;
  fallbackRoutingModelIds?: string[] | undefined;
  policies?: RoutingPolicy[] | undefined;
}

/** Every model id used to *score* candidates: router-level fields and `llm` policy config. */
export function routingModelRefs(src: RoutingModelSource): string[] {
  const ids = [src.routingModelId, ...(src.fallbackRoutingModelIds ?? [])];
  for (const p of src.policies ?? []) {
    if (p.type !== 'llm') continue;
    ids.push(p.config?.routingModelId, ...(Array.isArray(p.config?.fallbackModelIds) ? p.config.fallbackModelIds : []));
  }
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/**
 * Write-time check: a routing model resolves only through the model registry
 * (llm policy `allModels.find`), so an unregistered id can never work. Only ids
 * the write adds are checked, so a legacy record stays editable. Returns the
 * 400 message, or `null` when valid.
 */
export async function validateRoutingModels(next: RoutingModelSource, previous?: RoutingModelSource): Promise<string | null> {
  const already = new Set(previous ? routingModelRefs(previous) : []);
  const added = routingModelRefs(next).filter(id => !already.has(id));
  if (added.length === 0) return null;
  const known = new Set((await listEffectiveModelsIncludingDisabled()).map(m => m.id));
  const unknown = added.filter(id => !known.has(id));
  if (unknown.length === 0) return null;
  return `Routing model${unknown.length > 1 ? 's' : ''} not in the model registry: ${unknown.join(', ')}`;
}
