import type { FastifyPluginAsync } from 'fastify';
import type { ChatCompletionRequest, ModelObject } from '@routerly/shared';
import type { ResponsesRequest } from '../provider/responses-compat.js';
import { listEffectiveModels } from '../provider/list-effective.js';
import { buildOpenAIContext, buildResponsesContext, runProxy, getProxyPipeline } from '../reverse-proxy/index.js';

const ADA_PLACEHOLDER: ModelObject = {
  id: 'routerly/ada',
  object: 'model',
  created: 0,
  owned_by: 'routerly',
};

export const openaiRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/chat/completions ───────────────────────────────────────────────
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request, reply) => {
      const ctx = buildOpenAIContext(request, reply);
      await runProxy(getProxyPipeline(), ctx);
      return reply;
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
      return reply;
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

    return reply.send({ object: 'list', data: [ADA_PLACEHOLDER, ...data] });
  });

  // ─── GET /v1/models/* ─────────────────────────────────────────────────────────
  // Wildcard: model ids contain a literal "/" (provider/model), which the OpenAI SDK
  // does not encode. find-my-way decodes %2F too, so both forms resolve.
  fastify.get<{ Params: { '*': string } }>('/v1/models/*', async (request, reply) => {
    const id = request.params['*'];
    const notFound = () => reply.status(404).send({
      error: {
        message: `The model '${id}' does not exist or is not available to this router.`,
        type: 'invalid_request_error',
        param: null,
        code: 'model_not_found',
      },
    });

    // Sentinel listed by GET /v1/models; must stay retrievable.
    if (id === ADA_PLACEHOLDER.id) return reply.send(ADA_PLACEHOLDER);

    // client-facing list: only models on enabled connections are routable
    const allModels = await listEffectiveModels();
    if (!request.router.models.some((ref) => ref.modelId === id)) return notFound();
    const modelInfo = allModels.find((m) => m.id === id);
    if (!modelInfo) return notFound();

    const data: ModelObject = {
      id: modelInfo.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: modelInfo.provider,
    };
    return reply.send(data);
  });
};
