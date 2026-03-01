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

  // ─── POST /v1/messages/count_tokens ──────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages/count_tokens', async (request, reply) => {
    // We do a rough estimate of tokens here instead of calling a model because
    // real token counting requires tokenizer specific to the chosen model,
    // which we might not have locally without a library like tiktoken (for OpenAI only).
    // The spec requires this endpoint. We'll simply use the heuristic we already have.
    const body = request.body;
    let text = '';

    if (body.system) text += body.system + ' ';
    for (const msg of body.messages || []) {
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

    // Rough estimate: 1 token ~= 4 chars
    const input_tokens = Math.ceil(text.length / 4);

    return reply.send({
      input_tokens
    });
  });
};
