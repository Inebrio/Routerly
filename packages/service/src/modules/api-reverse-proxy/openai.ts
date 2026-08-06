import type { FastifyPluginAsync } from 'fastify';
import type { ChatCompletionRequest, ModelObject } from '@routerly/shared';
import type { ResponsesRequest } from '../provider/responses-compat.js';
import { listEffectiveModels } from '../provider/list-effective.js';
import { buildOpenAIContext, buildResponsesContext, runProxy, getProxyPipeline } from '../reverse-proxy/index.js';

export const openaiRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/chat/completions ───────────────────────────────────────────────
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request, reply) => {
      const ctx = buildOpenAIContext(request, reply);
      await runProxy(getProxyPipeline(), ctx);
    },
  );

  // ─── POST /v1/responses ───────────────────────────────────────────────────────
  fastify.post<{ Body: ResponsesRequest }>(
    '/v1/responses',
    async (request, reply) => {
      // Server-side conversation state: Routerly keeps none, and silently answering
      // without the prior turns would be worse than saying so.
      if (request.body?.previous_response_id) {
        return reply.code(400).send({
          error: {
            message: 'previous_response_id is not supported: Routerly does not store conversation state. Send the full input list instead.',
            type: 'invalid_request_error',
            param: 'previous_response_id',
            code: null,
          },
        });
      }
      // Same lane as chat/completions: the body is decoded to the chat view here and
      // re-encoded as a `response` object / Responses SSE at egress.
      const ctx = buildResponsesContext(request, reply);
      await runProxy(getProxyPipeline(), ctx);
    }
  );

  // ─── GET /v1/models ───────────────────────────────────────────────────────────
  fastify.get('/v1/models', async (request, reply) => {
    const router = request.router;
    // client-facing list: only models on enabled connections are routable
    const allModels = await listEffectiveModels();

    const routerModels = router.models
      .map((ref) => allModels.find((m) => m.id === ref.modelId))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);

    const data: ModelObject[] = routerModels.map((m) => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
    }));

    const adaPlaceholder: ModelObject = {
      id: 'routerly/ada',
      object: 'model',
      created: 0,
      owned_by: 'routerly',
    };

    return reply.send({ object: 'list', data: [adaPlaceholder, ...data] });
  });

  // ─── GET /v1/models/:model ────────────────────────────────────────────────────
  fastify.get<{ Params: { model: string } }>('/v1/models/:model', async (request, reply) => {
    const router = request.router;
    // client-facing list: only models on enabled connections are routable
    const allModels = await listEffectiveModels();

    // Ensure the model is available to the router
    const isAvailable = router.models.some((ref) => ref.modelId === request.params.model);
    if (!isAvailable) {
      return reply.status(404).send({
        error: { type: 'not_found', message: `Model '${request.params.model}' not found or not available to this router.` }
      });
    }

    const modelInfo = allModels.find((m) => m.id === request.params.model);
    if (!modelInfo) {
      return reply.status(404).send({
        error: { type: 'not_found', message: `Model '${request.params.model}' not found.` }
      });
    }

    const data: ModelObject = {
      id: modelInfo.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: modelInfo.provider,
    };

    return reply.send(data);
  });
};
