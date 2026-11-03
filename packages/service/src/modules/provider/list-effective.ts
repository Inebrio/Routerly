import type { EffectiveModel } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { resolveEffectiveModel } from './resolve.js';

async function build(includeDisabled: boolean): Promise<EffectiveModel[]> {
  const [connections, instances] = await Promise.all([readConfig('connections'), readConfig('instances')]);
  const byId = new Map(connections.map((c) => [c.id, c]));
  const out: EffectiveModel[] = [];
  for (const instance of instances) {
    const connection = byId.get(instance.connectionId);
    if (!connection) continue; // dangling instance
    if (!includeDisabled && !connection.enabled) continue;
    out.push(resolveEffectiveModel(instance, connection));
  }
  return out;
}

/** Effective models for routing/execution: instances of enabled connections only. Static resolve, no live token fetch. */
export const listEffectiveModels = (): Promise<EffectiveModel[]> => build(false);

/** Effective models including those on disabled connections. For management/list endpoints. */
export const listEffectiveModelsIncludingDisabled = (): Promise<EffectiveModel[]> => build(true);
