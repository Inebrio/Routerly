import type { AgentPolicy, ModelConfig, ProjectConfig, RoutingCandidate } from '@routerly/shared';

/** Header carrying the agent policy name (#78). */
export const AGENT_POLICY_HEADER = 'x-routerly-policy';

/**
 * Resolve an agent policy by name from the project config.
 * Returns undefined if the header is absent or no matching policy exists.
 */
export function resolveAgentPolicy(
  project: ProjectConfig,
  policyName: string | undefined,
): AgentPolicy | undefined {
  if (!policyName) return undefined;
  return (project.agentPolicies ?? []).find((p) => p.name === policyName);
}

/**
 * Build the ordered candidate list for an agent policy override.
 * Keeps only models that exist in `allModels`, preserving the policy's order.
 * Highest weight first (descending) so the standard fallback loop tries them
 * in the declared preference order.
 */
export function agentPolicyCandidates(
  policy: AgentPolicy,
  allModels: ModelConfig[],
): RoutingCandidate[] {
  const known = policy.models.filter((id) => allModels.some((m) => m.id === id));
  const total = known.length;
  return known.map((model, idx) => ({ model, weight: total - idx }));
}
