import type { ChatCompletionRequest, ProjectConfig, RoutingResponse } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { getProviderAdapter } from '../providers/index.js';

const ROUTING_SYSTEM_PROMPT = `You are a request router for an LLM gateway.
Given a user's request, you must select the best models from the available list and return them in order of preference.
Always respond with ONLY a JSON object in this exact format:
{
  "models": [
    { "model": "<model_id>", "weight": <0.0-1.0> },
    ...
  ]
}
Do not include any explanation, only the JSON object.`;

/**
 * Invokes the project's routing model to get a weighted list of candidate models.
 */
export async function routeRequest(
  originalRequest: ChatCompletionRequest,
  project: ProjectConfig,
): Promise<RoutingResponse> {
  const allModels = await readConfig('models');

  const routingModel = allModels.find((m) => m.id === project.routingModelId);
  if (!routingModel) {
    throw new Error(
      `Routing model "${project.routingModelId}" not found for project "${project.id}"`,
    );
  }

  // Build the list of available model IDs for the routing model to choose from
  const availableModelIds = project.models.map((ref) => ref.modelId).join(', ');

  const routingRequest: ChatCompletionRequest = {
    model: routingModel.id,
    messages: [
      {
        role: 'system',
        content: `${ROUTING_SYSTEM_PROMPT}\n\nAvailable model IDs: ${availableModelIds}`,
      },
      {
        role: 'user',
        content: `Route this request. Original model requested: "${originalRequest.model}". Message count: ${originalRequest.messages.length}. First message role: "${originalRequest.messages[0]?.role ?? 'unknown'}"`,
      },
    ],
    temperature: 0,
    max_tokens: 256,
  };

  const adapter = getProviderAdapter(routingModel);
  const response = await adapter.chatCompletion(routingRequest, routingModel);

  const rawContent = response.choices[0]?.message.content;
  if (typeof rawContent !== 'string') {
    throw new Error('Routing model returned no content');
  }

  // Extract JSON from response (may be wrapped in markdown code block)
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch || !jsonMatch[0]) {
    throw new Error(`Routing model returned invalid JSON: ${rawContent}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as RoutingResponse;
  if (!Array.isArray(parsed.models)) {
    throw new Error('Routing model JSON missing "models" array');
  }

  return parsed;
}
