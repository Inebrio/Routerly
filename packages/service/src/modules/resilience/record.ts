import type { ModelConfig, ResilienceFault, ResilienceStore } from '@routerly/shared';
import { resilienceKeys } from './keys.js';

/**
 * Maps a classified fault to the resilience level it belongs to. This table is the SINGLE
 * authority for category→level; every fault-record call site routes through recordFault so the
 * mapping lives in exactly one place.
 *
 *   auth | server | timeout                 → provider  (hard fault: trip the provider breaker)
 *   rate-limit | quota                       → connection (cooldown: one connection is throttled)
 *   model-not-found | content-safety         → model      (lockout: a single model instance)
 *   invalid-request                          → model      (store no-ops it to lastFault only)
 */
const LEVEL: Record<ResilienceFault['category'], 'provider' | 'connection' | 'model'> = {
  auth: 'provider',
  server: 'provider',
  timeout: 'provider',
  'rate-limit': 'connection',
  quota: 'connection',
  'model-not-found': 'model',
  'content-safety': 'model',
  'invalid-request': 'model',
};

/**
 * Records a classified upstream fault at the correct resilience level. The ONE source of truth for
 * category→level: a per-model 404/content refusal locks out only that model instance, a rate-limit
 * cools down the connection, and a hard fault trips the whole provider breaker.
 *
 * // ponytail: LEVEL above is the single authority for category→level — change it there, nowhere else.
 */
export function recordFault(store: ResilienceStore | undefined, model: ModelConfig, fault: ResilienceFault): void {
  store?.record(resilienceKeys(model)[LEVEL[fault.category]], fault);
}
