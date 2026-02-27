// ─── Routing model response type ─────────────────────────────────────────────

export interface RoutingCandidate {
  /** Model ID as registered in models.json */
  model: string;
  /** Priority weight (higher = preferred). Not probabilistic. */
  weight: number;
}

export interface RoutingResponse {
  models: RoutingCandidate[];
}
