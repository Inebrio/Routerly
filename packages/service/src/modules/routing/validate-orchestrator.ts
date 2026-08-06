import type { OrchestratorCandidateRef, RouterConfig, RouterKind } from '@routerly/shared';

export interface ValidateOrchestratorCandidatesParams {
  /** Resolved kind the router is being saved as (already defaulted to 'router' by the caller if absent). */
  kind: RouterKind;
  candidates: OrchestratorCandidateRef[] | undefined;
  /** Router list to validate against — the caller re-reads this immediately before the write (EC4). */
  routers: RouterConfig[];
  /** The router's own id. Present on PUT (enables the self-reference check); absent on POST — the id doesn't exist yet. */
  selfId?: string;
}

/**
 * Validates an Orchestrator's candidate list at write time (EC2, AC3, AC4).
 * Returns the 400 error message to send, or `null` when the candidates are
 * valid (or `kind !== 'orchestrator'`, where candidates are not read at all).
 */
export function validateOrchestratorCandidates(params: ValidateOrchestratorCandidatesParams): string | null {
  const { kind, candidates, routers, selfId } = params;
  if (kind !== 'orchestrator') return null;

  if (!candidates || candidates.length === 0) {
    return 'An orchestrator needs at least one candidate router';
  }

  for (const candidate of candidates) {
    if (selfId !== undefined && candidate.routerId === selfId) {
      return 'An orchestrator cannot target itself';
    }
    const target = routers.find(r => r.id === candidate.routerId);
    if (!target) {
      return `Unknown candidate router: ${candidate.routerId}`;
    }
    if ((target.kind ?? 'router') !== 'router') {
      return 'An orchestrator cannot target another orchestrator';
    }
  }

  return null;
}
