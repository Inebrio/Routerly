import type { ChatCompletionRequest, ProjectConfig, RoutingResponse, RoutingTraceLog } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { applyContextPolicy, applyCheapestPolicy, applyHealthPolicy, applyFallbackPolicy, applyLlmPolicy } from './policies.js';
import { debugLog } from './traces.js';

/**
 * Invokes the project's routing policies to get a weighted list of candidate models.
 */
export async function routeRequest(
  originalRequest: ChatCompletionRequest,
  project: ProjectConfig,
): Promise<RoutingResponse> {
  const allModels = await readConfig('models');

  // Load candidate models based on project's model references
  const projectModelIds = new Set(project.models.map(m => m.modelId));

  if (project.policies) {
    for (const policy of project.policies) {
      if ((policy.type === 'llm' || policy.type === 'fallback') && policy.config?.fallbackModelIds) {
        (policy.config.fallbackModelIds as string[]).forEach(id => projectModelIds.add(id));
      }
    }
  }
  if (project.fallbackRoutingModelIds) {
    project.fallbackRoutingModelIds.forEach(id => projectModelIds.add(id));
  }

  const candidates = allModels
    .filter(m => projectModelIds.has(m.id))
    .map(m => ({ model: m, weight: 1.0 }));

  if (candidates.length === 0) {
    throw new Error(`Project "${project.id}" has no valid models configured.`);
  }

  // If policies exist, push candidates through the pipeline
  let pipelineCandidates = candidates;
  const trace: RoutingTraceLog[] = [{
    timestamp: new Date().toISOString(),
    policy: 'system',
    message: `Initialized routing for ${candidates.length} candidate models.`,
    details: { projectModelIds: Array.from(projectModelIds) }
  }];

  if (project.policies && project.policies.length > 0) {
    debugLog('[API] Evaluating project policies...');
    for (const policy of project.policies) {
      if (!policy.enabled) continue;
      debugLog(`[API] Evaluating policy: ${policy.type}`);

      switch (policy.type) {
        case 'context':
          pipelineCandidates = applyContextPolicy(pipelineCandidates, originalRequest, policy, trace);
          break;
        case 'cheapest':
          pipelineCandidates = applyCheapestPolicy(pipelineCandidates, policy, trace);
          break;
        case 'health':
          pipelineCandidates = await applyHealthPolicy(pipelineCandidates, policy, trace);
          break;
        case 'fallback':
          pipelineCandidates = applyFallbackPolicy(pipelineCandidates, policy, trace);
          break;
        case 'llm':
          if (policy.config?.autoRouting !== false) {
            debugLog(`[API] Evaluating LLM Policy...`);
            pipelineCandidates = await applyLlmPolicy(pipelineCandidates, originalRequest, project, policy, trace);
            debugLog(`[API] Finished evaluating LLM Policy...`);
          }
          // The UI nests fallback models into the LLM policy
          if (policy.config?.fallbackModelIds && policy.config.fallbackModelIds.length > 0) {
            pipelineCandidates = applyFallbackPolicy(pipelineCandidates, {
              type: 'fallback',
              enabled: true,
              weight: policy.weight,
              config: { fallbackModelIds: policy.config.fallbackModelIds }
            }, trace);
          }
          break;
        default:
          console.warn(`Unknown routing policy type: ${policy.type}`);
      }
    }
  } else {
    debugLog('[API] Evaluating legacy mapping...');
    // Legacy routing / graceful migration
    if (!project.autoRouting && project.routingModelId) {
      // Simulate LLM routing policy
      debugLog(`[API] Evaluating simulated LLM Routing Policy...`);
      pipelineCandidates = await applyLlmPolicy(
        pipelineCandidates,
        originalRequest,
        project,
        { type: 'llm', enabled: true, weight: 1.0 },
        trace
      );
      debugLog(`[API] Finished simulating LLM Routing Policy...`);
    }
    if (project.fallbackRoutingModelIds && project.fallbackRoutingModelIds.length > 0) {
      // Simulate Fallback policy
      pipelineCandidates = applyFallbackPolicy(
        pipelineCandidates,
        { type: 'fallback', enabled: true, weight: 1.0, config: { fallbackModelIds: project.fallbackRoutingModelIds } },
        trace
      );
    }
  }

  // Sort final response by weight descending
  pipelineCandidates.sort((a, b) => b.weight - a.weight);

  return {
    models: pipelineCandidates.map(c => ({
      model: c.model.id,
      weight: c.weight,
    })),
    trace
  };
}
