import type { ChatCompletionRequest, ModelConfig, ProjectConfig, RoutingPolicy, RoutingTraceLog } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { getProviderAdapter } from '../providers/index.js';
import { debugLog } from './traces.js';
import { DEFAULT_ROUTING_SYSTEM_PROMPT } from './prompts/systemPrompt.js';
import { buildDefaultRoutingUserPrompt, type RoutingOption } from './prompts/userPrompt.js';

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
  policy: RoutingPolicy,
  trace: RoutingTraceLog[]
): { model: ModelConfig; weight: number }[] {
  if (!policy.enabled) return candidates;

  const estimatedTokens = estimateTokens(request);

  const kept: typeof candidates = [];
  const dropped: string[] = [];

  for (const c of candidates) {
    if (!c.model.contextWindow) {
      kept.push(c);
    } else if (c.model.contextWindow >= estimatedTokens) {
      kept.push(c);
    } else {
      dropped.push(c.model.id);
    }
  }

  if (dropped.length > 0) {
    trace.push({
      timestamp: new Date().toISOString(),
      policy: 'context',
      message: `Dropped models due to context size < ${estimatedTokens} estimated tokens.`,
      details: { droppedModels: dropped, estimatedTokens }
    });
  }

  return kept;
}

/**
 * Evaluates the Cheapest policy.
 * Increases the weight of models with lower costs.
 */
export function applyCheapestPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  policy: RoutingPolicy,
  trace: RoutingTraceLog[]
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

  const bonuses: Record<string, number> = {};

  const result = candidates.map(c => {
    const cost = c.model.cost.inputPerMillion + c.model.cost.outputPerMillion;
    // Lower cost = higher inverse ratio = higher weight bonus
    const inverseCostRatio = 1 - (cost / maxCost);
    const bonus = inverseCostRatio * policy.weight;
    if (bonus > 0) {
      bonuses[c.model.id] = bonus;
    }
    return {
      model: c.model,
      // Add bonus proportional to the policy weight
      weight: c.weight + bonus
    };
  });

  if (Object.keys(bonuses).length > 0) {
    trace.push({
      timestamp: new Date().toISOString(),
      policy: 'cheapest',
      message: 'Applied weight bonuses based on cost efficiency.',
      details: { maxCost, weightBonuses: bonuses }
    });
  }

  return result;
}

/**
 * Evaluates the Health policy.
 * Lowers the weight of models with high error rates in recent usage.
 */
export async function applyHealthPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  policy: RoutingPolicy,
  trace: RoutingTraceLog[]
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
        let s = stats[r.modelId];
        if (!s) {
          s = { total: 0, errors: 0 };
          stats[r.modelId] = s;
        }
        s.total++;
        if (r.outcome === 'error' || r.outcome === 'timeout') {
          s.errors++;
        }
      }
    }

    const penalties: Record<string, number> = {};

    const result = candidates.map(c => {
      const modelStats = stats[c.model.id];
      if (!modelStats || modelStats.total < 3) return c; // Not enough data

      const errorRate = modelStats.errors / modelStats.total;

      // If error rate is high, significantly decrease weight
      // A 100% error rate drops weight by (policy.weight * 2)
      if (errorRate > 0) {
        const penalty = errorRate * policy.weight * 2;
        penalties[c.model.id] = penalty;
        return {
          model: c.model,
          weight: c.weight - penalty
        };
      }
      return c;
    });

    if (Object.keys(penalties).length > 0) {
      trace.push({
        timestamp: new Date().toISOString(),
        policy: 'health',
        message: 'Applied weight penalties due to recent errors.',
        details: { penalties }
      });
    }

    return result;
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
  policy: RoutingPolicy,
  trace: RoutingTraceLog[]
): { model: ModelConfig; weight: number }[] {
  if (!policy.enabled || !policy.config || !policy.config.fallbackModelIds) return candidates;

  const fallbackIds = new Set<string>(policy.config.fallbackModelIds as string[]);

  const penalties: Record<string, number> = {};
  const weight = policy.weight ?? 1;

  const result = candidates.map(c => {
    if (fallbackIds.has(c.model.id)) {
      // Heavily penalize fallback models so they fall to the bottom of the list
      // The exact penalty depends on the policy weight.
      const penalty = 10 * weight;
      penalties[c.model.id] = penalty;
      return {
        model: c.model,
        weight: c.weight - penalty
      };
    }
    return c;
  });

  if (Object.keys(penalties).length > 0) {
    trace.push({
      timestamp: new Date().toISOString(),
      policy: 'fallback',
      message: 'Penalized models designated as fallback routers.',
      details: { penalizedModels: Array.from(fallbackIds), penaltyAmount: 10 * weight }
    });
  }

  return result;
}

/**
 * Evaluates the LLM Routing policy.
 * Asks an LLM routing model to evaluate the request and return weights.
 */
export async function applyLlmPolicy(
  candidates: { model: ModelConfig; weight: number }[],
  request: ChatCompletionRequest,
  project: ProjectConfig,
  policy: RoutingPolicy,
  trace: RoutingTraceLog[]
): Promise<{ model: ModelConfig; weight: number }[]> {
  if (!policy.enabled) return candidates;

  const routingModelId = policy.config?.routingModelId || project.routingModelId;
  debugLog(`[LLM Policy] Selected routingModelId: ${routingModelId}`);
  if (!routingModelId) {
    trace.push({
      timestamp: new Date().toISOString(),
      policy: 'llm',
      message: 'Skipped LLM routing policy because no routing model ID was configured.'
    });
    return candidates;
  }

  const allModels = await readConfig('models');
  const availableModelIds = candidates.map((c) => c.model.id).join(', ');

  let routingSystemPrompt = (policy.config?.enableSystemPromptOverwrite && policy.config?.systemPrompt) ? policy.config.systemPrompt : DEFAULT_ROUTING_SYSTEM_PROMPT;

  if (policy.config?.autoRouting === false) {
    const targetModelPrompts = project.models
      .filter(m => candidates.some(c => c.model.id === m.modelId) && m.prompt)
      .map(m => `- Model: ${m.modelId}\n  Instructions: ${m.prompt}`)
      .join('\n\n');

    if (targetModelPrompts) {
      routingSystemPrompt += `\n\nTarget Model Selection Instructions:\n${targetModelPrompts}`;
    }
  }

  // Build per-model routing options (modelId + optional custom prompt) for the user prompt
  const routingOptions: RoutingOption[] = candidates.map((c) => {
    const projectRef = project.models.find((m) => m.modelId === c.model.id);
    return { modelId: c.model.id, prompt: projectRef?.prompt };
  });

  const userContent = (policy.config?.enableUserPromptOverwrite && policy.config?.userPrompt)
    ? policy.config.userPrompt
    : buildDefaultRoutingUserPrompt(request, routingOptions);

  const temperature = policy.config?.temperature ?? 0;
  const maxTokens = policy.config?.maxTokens ?? 256;

  // Build ordered list of routing model IDs to attempt: primary + optional fallback routing models
  const fallbackRoutingModelIds: string[] = (policy.config?.fallbackRoutingModelIds as string[] | undefined) ?? [];
  const routingModelIdsToTry = [routingModelId, ...fallbackRoutingModelIds.filter(id => id !== routingModelId)];

  for (const rmId of routingModelIdsToTry) {
    const routingModel = allModels.find(m => m.id === rmId);
    if (!routingModel) {
      trace.push({
        timestamp: new Date().toISOString(),
        policy: 'llm',
        message: `Routing model "${rmId}" not found, skipping.`
      });
      continue;
    }

    const routingRequest: ChatCompletionRequest = {
      model: routingModel.id,
      messages: [
        {
          role: 'system',
          content: routingSystemPrompt,
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      temperature: temperature,
      max_tokens: maxTokens,
    };

    try {
      const adapter = getProviderAdapter(routingModel);

      trace.push({
        timestamp: new Date().toISOString(),
        policy: 'llm',
        message: `Querying routing model "${routingModel.id}"...`,
        details: {
          model: routingModel.id,
          systemPrompt: routingSystemPrompt,
          availableModelIds,
          userPrompt: userContent,
          temperature,
          maxTokens
        }
      });

      debugLog(`[LLM Policy] Awaiting adapter.chatCompletion for model ${routingModel.id}...`);
      const response = await adapter.chatCompletion(routingRequest, routingModel);
      debugLog(`[LLM Policy] Received response from adapter.`);

      const rawContent = response.choices[0]?.message.content;
      if (typeof rawContent !== 'string') {
        trace.push({
          timestamp: new Date().toISOString(),
          policy: 'llm',
          message: `Routing model "${routingModel.id}" did not return a string response, trying next.`,
          details: { rawContent }
        });
        continue;
      }

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch || !jsonMatch[0]) {
        trace.push({
          timestamp: new Date().toISOString(),
          policy: 'llm',
          message: `Routing model "${routingModel.id}" did not return valid JSON, trying next.`,
          details: { responseText: rawContent }
        });
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      // Allow both new structure (parsed.routing) and old structure (parsed.models) for backward compat with custom prompts
      const routingArray = Array.isArray(parsed.routing) ? parsed.routing : (Array.isArray(parsed.models) ? parsed.models : null);

      if (!routingArray) {
        trace.push({
          timestamp: new Date().toISOString(),
          policy: 'llm',
          message: `Routing model "${routingModel.id}" JSON did not contain a valid "routing" or "models" array, trying next.`,
          details: { responseData: parsed }
        });
        continue;
      }

      // Create lookup map for LLM weights
      const llmWeights = new Map<string, number>();
      const totalModels = routingArray.length;
      for (let i = 0; i < totalModels; i++) {
        const item = routingArray[i];
        if (item && typeof item === 'object' && item.model) {
          // If it has an explicit weight (old format), use it.
          // Otherwise, calculate a weight based on the order in the array (highest for index 0)
          let w = typeof item.weight === 'number' ? item.weight : (1.0 - (i / totalModels));
          // Ensure minimum weight is greater than 0 if it's in the list
          w = Math.max(w, 0.1);
          llmWeights.set(item.model, w);
        }
      }

      trace.push({
        timestamp: new Date().toISOString(),
        policy: 'llm',
        message: `Successfully received weights from routing model "${routingModel.id}".`,
        details: { parsedWeights: Object.fromEntries(llmWeights.entries()) }
      });

      // Apply weights and return — routing successful
      return candidates.map(c => {
        const llmWeight = llmWeights.get(c.model.id) || 0;
        return {
          ...c,
          weight: c.weight + (llmWeight * policy.weight)
        };
      });

    } catch (e: any) {
      const isLast = routingModelIdsToTry.indexOf(rmId) === routingModelIdsToTry.length - 1;
      trace.push({
        timestamp: new Date().toISOString(),
        policy: 'llm',
        message: `Routing model "${rmId}" failed: ${e.message}${isLast ? '.' : '. Trying next...'}`,
        details: { error: e.toString() }
      });
      // Continue to try next routing model in the list
    }
  }

  // All routing models exhausted
  trace.push({
    timestamp: new Date().toISOString(),
    policy: 'llm',
    message: 'All configured routing models were exhausted. Keeping original candidate weights.'
  });
  return candidates;
}
