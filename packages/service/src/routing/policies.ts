import type { ChatCompletionRequest, ModelConfig, ProjectConfig, RoutingPolicy } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { getProviderAdapter } from '../providers/index.js';

/**
 * Calculates a rough estimate of tokens in the request
 */
export function estimateTokens(request: ChatCompletionRequest): number {
  let text = '';
  for (const msg of request.messages) {
    if (typeof msg.content === 'string') {
      text += msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          text += part.text;
        }
      }
    }
  }
  // Rough heuristic: 1 token ~= 4 chars (average English)
  return Math.ceil(text.length / 4);
}

/**
 * Evaluates the Context Size policy.
 * Filters out models whose context window is smaller than the estimated tokens.
 */
export function applyContextPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  request: ChatCompletionRequest,
  policy: RoutingPolicy
): { model: ModelConfig; weight: number }[] {
  if (!policy.enabled) return candidates;

  const estimatedTokens = estimateTokens(request);

  return candidates.filter(c => {
    // If context window is not defined, we can't filter it out, assume it's large enough
    if (!c.model.contextWindow) return true;
    return c.model.contextWindow >= estimatedTokens;
  });
}

/**
 * Evaluates the Cheapest policy.
 * Increases the weight of models with lower costs.
 */
export function applyCheapestPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  policy: RoutingPolicy
): { model: ModelConfig; weight: number }[] {
  if (!policy.enabled || candidates.length === 0) return candidates;

  // Find the max cost to normalize
  let maxCost = 0;
  for (const c of candidates) {
    const cost = c.model.cost.inputPerMillion + c.model.cost.outputPerMillion;
    if (cost > maxCost) maxCost = cost;
  }

  // If all models are free, maxCost is 0
  if (maxCost === 0) return candidates;

  return candidates.map(c => {
    const cost = c.model.cost.inputPerMillion + c.model.cost.outputPerMillion;
    // Lower cost = higher inverse ratio = higher weight bonus
    const inverseCostRatio = 1 - (cost / maxCost);
    return {
      model: c.model,
      // Add bonus proportional to the policy weight
      weight: c.weight + (inverseCostRatio * policy.weight)
    };
  });
}

/**
 * Evaluates the Health policy.
 * Lowers the weight of models with high error rates in recent usage.
 */
export async function applyHealthPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  policy: RoutingPolicy
): Promise<{ model: ModelConfig; weight: number }[]> {
  if (!policy.enabled) return candidates;

  try {
    const records = await readConfig('usage');
    // Look at last 10 minutes
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Calculate error rates per model
    const stats: Record<string, { total: number; errors: number }> = {};
    for (const r of records) {
      if (new Date(r.timestamp) > tenMinsAgo) {
        if (!stats[r.modelId]) stats[r.modelId] = { total: 0, errors: 0 };
        stats[r.modelId].total++;
        if (r.outcome === 'error' || r.outcome === 'timeout') {
          stats[r.modelId].errors++;
        }
      }
    }

    return candidates.map(c => {
      const modelStats = stats[c.model.id];
      if (!modelStats || modelStats.total < 3) return c; // Not enough data

      const errorRate = modelStats.errors / modelStats.total;

      // If error rate is high, significantly decrease weight
      // A 100% error rate drops weight by (policy.weight * 2)
      return {
        model: c.model,
        weight: c.weight - (errorRate * policy.weight * 2)
      };
    });
  } catch (err) {
    // Return unmodified on error
    return candidates;
  }
}

/**
 * Evaluates the Fallback policy.
 * Decreases the weight of designated fallback models so they are only picked last.
 */
export function applyFallbackPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  policy: RoutingPolicy
): { model: ModelConfig; weight: number }[] {
  if (!policy.enabled || !(policy.config?.fallbackModelIds)) return candidates;

  const fallbackIds = new Set<string>(policy.config.fallbackModelIds as string[]);

  return candidates.map(c => {
    if (fallbackIds.has(c.model.id)) {
      // Heavily penalize fallback models so they fall to the bottom of the list
      // The exact penalty depends on the policy weight.
      return {
        model: c.model,
        weight: c.weight - (10 * policy.weight)
      };
    }
    return c;
  });
}

/**
 * Evaluates the LLM Routing policy.
 * Asks an LLM routing model to evaluate the request and return weights.
 */
export async function applyLlmPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  request: ChatCompletionRequest,
  project: ProjectConfig,
  policy: RoutingPolicy
): Promise<{ model: ModelConfig; weight: number }[]> {
  if (!policy.enabled) return candidates;

  const routingModelId = policy.config?.routingModelId || project.routingModelId;
  if (!routingModelId) return candidates;

  const allModels = await readConfig('models');
  const routingModel = allModels.find(m => m.id === routingModelId);
  if (!routingModel) return candidates;

  const availableModelIds = candidates.map((c) => c.model.id).join(', ');

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

  const routingRequest: ChatCompletionRequest = {
    model: routingModel.id,
    messages: [
      {
        role: 'system',
        content: `${ROUTING_SYSTEM_PROMPT}\n\nAvailable model IDs: ${availableModelIds}`,
      },
      {
        role: 'user',
        content: `Route this request. Original model requested: "${request.model}". Message count: ${request.messages.length}. First message role: "${request.messages[0]?.role ?? 'unknown'}"`,
      },
    ],
    temperature: 0,
    max_tokens: 256,
  };

  try {
    const adapter = getProviderAdapter(routingModel);
    const response = await adapter.chatCompletion(routingRequest, routingModel);

    const rawContent = response.choices[0]?.message.content;
    if (typeof rawContent !== 'string') return candidates;

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch || !jsonMatch[0]) return candidates;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.models)) return candidates;

    // Create lookup map for LLM weights
    const llmWeights = new Map<string, number>();
    for (const item of parsed.models) {
      if (item.model && typeof item.weight === 'number') {
        llmWeights.set(item.model, item.weight);
      }
    }

    // Apply weights
    return candidates.map(c => {
      const llmWeight = llmWeights.get(c.model.id) || 0;
      return {
        ...c,
        weight: c.weight + (llmWeight * policy.weight)
      };
    });

  } catch (e) {
    // Fallback to original candidates if routing model fails
    return candidates;
  }
}
