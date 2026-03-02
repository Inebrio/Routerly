import type { ChatCompletionRequest, ProjectConfig, RoutingResponse } from '@localrouter/shared';

/**
 * Routes an incoming request to a weighted list of candidate models.
 *
 * TODO: Implement routing logic.
 *   1. Invoke the project's routingModelId (LLM) passing the request content.
 *   2. Parse the JSON response to obtain the ordered, weighted candidates list.
 *   3. Return candidates sorted by weight descending.
 *   Fallback routing models (fallbackRoutingModelIds) should be tried in order
 *   if the primary routing model fails.
 */
export async function routeRequest(
  _request: ChatCompletionRequest,
  _project: ProjectConfig,
): Promise<RoutingResponse> {
  throw new Error('Routing not implemented yet.');
}
