import type { RouterKind, RoutingPolicy } from '@routerly/shared';

/**
 * Policy types that score a Router candidate as a whole (weight/health/rate-limit/
 * fairness). Every other type (`cheapest`, `capability`, `context`, `performance`,
 * `llm`, `semantic-intent`, `model-preference`, `budget-remaining`) picks among a
 * *pool of models* — an Orchestrator has no models of its own to score, so those
 * types are rejected at write time instead of being silently stored and ignored.
 */
export const ORCHESTRATOR_POLICY_TYPES: RoutingPolicy['type'][] = ['health', 'rate-limit', 'fairness'];

/**
 * Validates a router's `policies` array at write time. Returns the 400 error
 * message to send, or `null` when valid (or `kind !== 'orchestrator'`, where
 * every policy type is allowed, same as today).
 */
export function validateOrchestratorPolicies(kind: RouterKind, policies: RoutingPolicy[] | undefined): string | null {
  if (kind !== 'orchestrator' || !policies) return null;
  const unsupported = policies.filter(p => !ORCHESTRATOR_POLICY_TYPES.includes(p.type)).map(p => p.type);
  if (unsupported.length === 0) return null;
  return `Orchestrators only support these policy types: ${ORCHESTRATOR_POLICY_TYPES.join(', ')} (got: ${unsupported.join(', ')})`;
}
