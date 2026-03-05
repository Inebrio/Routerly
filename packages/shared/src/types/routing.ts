// ─── Routing model response type ─────────────────────────────────────────────

export interface RoutingCandidate {
  /** Model ID as registered in models.json */
  model: string;
  /** Priority weight (higher = preferred). Not probabilistic. */
  weight: number;
  /** Optional per-project system prompt override for this model */
  prompt?: string;
}

export interface RoutingResponse {
  models: RoutingCandidate[];
}
