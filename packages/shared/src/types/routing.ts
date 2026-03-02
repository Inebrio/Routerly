// ─── Routing model response type ─────────────────────────────────────────────

export interface RoutingTraceLog {
  timestamp: string;
  policy: string;
  message: string;
  details?: Record<string, any>;
}

export interface RoutingCandidate {
  /** Model ID as registered in models.json */
  model: string;
  /** Priority weight (higher = preferred). Not probabilistic. */
  weight: number;
}

export interface RoutingResponse {
  models: RoutingCandidate[];
  trace?: RoutingTraceLog[];
}
