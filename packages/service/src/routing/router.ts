import type { ChatCompletionRequest, ProjectConfig, RoutingResponse } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';
import { applyContextPolicy, applyCheapestPolicy, applyHealthPolicy, applyFallbackPolicy, applyLlmPolicy } from './policies.js';

/**
 * Invokes the project's routing policies to get a weighted list of candidate models.
 */
export async function routeRequest(
  originalRequest: ChatCompletionRequest,
  project: ProjectConfig,
): Promise<RoutingResponse> {
  const allModels = await readConfig('models');

  // Load candidate models based on project's model references
  const projectModelIds = project.models.map(m => m.modelId);
  const candidates = allModels
    .filter(m => projectModelIds.includes(m.id))
    .map(m => ({ model: m, weight: 1.0 }));

  if (candidates.length === 0) {
    throw new Error(`Project "${project.id}" has no valid models configured.`);
  }

  // If policies exist, push candidates through the pipeline
  let pipelineCandidates = candidates;
  if (project.policies && project.policies.length > 0) {
    for (const policy of project.policies) {
      if (!policy.enabled) continue;

      switch (policy.type) {
        case 'context':
          pipelineCandidates = applyContextPolicy(pipelineCandidates, originalRequest, policy);
          break;
        case 'cheapest':
          pipelineCandidates = applyCheapestPolicy(pipelineCandidates, policy);
          break;
        case 'health':
          pipelineCandidates = await applyHealthPolicy(pipelineCandidates, policy);
          break;
        case 'fallback':
          pipelineCandidates = applyFallbackPolicy(pipelineCandidates, policy);
          break;
        case 'llm':
          if (!policy.config?.autoRouting) {
            pipelineCandidates = await applyLlmPolicy(pipelineCandidates, originalRequest, project, policy);
          }
          // The UI nests fallback models into the LLM policy
          if (policy.config?.fallbackModelIds && policy.config.fallbackModelIds.length > 0) {
            pipelineCandidates = applyFallbackPolicy(pipelineCandidates, {
              type: 'fallback',
              enabled: true,
              weight: policy.weight,
              config: { fallbackModelIds: policy.config.fallbackModelIds }
            });
          }
          break;
        default:
          console.warn(`Unknown routing policy type: ${policy.type}`);
      }
    }
  } else {
    // Legacy routing / graceful migration
    if (!project.autoRouting && project.routingModelId) {
      // Simulate LLM routing policy
      pipelineCandidates = await applyLlmPolicy(
        pipelineCandidates,
        originalRequest,
        project,
        { type: 'llm', enabled: true, weight: 1.0 }
      );
    }
    if (project.fallbackRoutingModelIds && project.fallbackRoutingModelIds.length > 0) {
      // Simulate Fallback policy
      pipelineCandidates = applyFallbackPolicy(
        pipelineCandidates,
        { type: 'fallback', enabled: true, weight: 1.0, config: { fallbackModelIds: project.fallbackRoutingModelIds } }
      );
    }
  }

  // Sort final response by weight descending
  pipelineCandidates.sort((a, b) => b.weight - a.weight);

  return {
    models: pipelineCandidates.map(c => ({
      model: c.model.id,
      weight: c.weight,
    }))
  };
}
