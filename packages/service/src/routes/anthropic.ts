import type { FastifyPluginAsync } from 'fastify';
import type { MessagesRequest } from '@localrouter/shared';
import { routeRequest } from '../routing/router.js';
import { selectModel } from '../routing/selector.js';
import { getProviderAdapter } from '../providers/index.js';
import { trackUsage } from '../cost/tracker.js';

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const project = request.project;
    const body = request.body;

    // Convert Anthropic request to OpenAI format for routing
    const openAICompatBody = {
      model: body.model,
      messages: body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      max_tokens: body.max_tokens,
    };

    // 1. Route request
    let routingResponse;
    try {
      routingResponse = await routeRequest(openAICompatBody, project);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Routing model failed');
      return reply.status(503).send({
        type: 'error',
        error: { type: 'overloaded_error', message: `Routing failed: ${msg}` },
      });
    }

    // 2. Select model
    const selectedModel = await selectModel(routingResponse, project);
    if (!selectedModel) {
      return reply.status(503).send({
        type: 'error',
        error: {
          type: 'overloaded_error',
          message: 'All candidate models are budget-exhausted or unavailable.',
        },
      });
    }

    const adapter = getProviderAdapter(selectedModel);
    if (!adapter.messages) {
      return reply.status(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `Model "${selectedModel.id}" does not support the Anthropic messages API.`,
        },
      });
    }

    const t0 = Date.now();
    try {
      const response = await adapter.messages(body, selectedModel);
      await trackUsage({
        projectId: project.id,
        model: selectedModel,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - t0,
        outcome: 'success',
      });
      return reply.send(response);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ err, modelId: selectedModel.id }, 'Anthropic messages call failed');
      await trackUsage({
        projectId: project.id,
        model: selectedModel,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - t0,
        outcome: 'error',
        errorMessage: msg,
      });
      return reply.status(503).send({
        type: 'error',
        error: { type: 'overloaded_error', message: msg },
      });
    }
  });
};
