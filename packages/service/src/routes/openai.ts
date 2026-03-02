import type { FastifyPluginAsync } from 'fastify';
import type { ChatCompletionRequest, ModelObject } from '@localrouter/shared';
import { routeRequest } from '../routing/router.js';
import { getProviderAdapter } from '../providers/index.js';
import { trackUsage } from '../cost/tracker.js';
import { readConfig } from '../config/loader.js';
import { isAllowed } from '../cost/budget.js';

export const openaiRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/chat/completions ───────────────────────────────────────────────
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request, reply) => {
      return handleOpenAICompletion(request, reply);
    },
  );

  // ─── POST /v1/responses ───────────────────────────────────────────────────────
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/responses',
    async (request, reply) => {
      // The new Responses API uses 'input' instead of 'messages' and 'max_output_tokens' instead of 'max_tokens'
      const body = { ...request.body };
      if (body.input && !body.messages) {
        body.messages = body.input;
      }
      if (body.max_tokens !== undefined) {
        body.max_output_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      if (body.max_completion_tokens !== undefined) {
        body.max_output_tokens = body.max_completion_tokens;
        delete body.max_completion_tokens;
      }

      // We can reuse the exact same routing and tracking logic from chat/completions
      // by simply forwarding the normalized body
      request.body = body;

      // Unfortunately we can't easily re-invoke the route directly, so we extract the logic or just delegate.
      // Since Fastify doesn't easily let us call another handler natively with the same request/reply,
      // we'll just replicate the top-level handler logic, or alternatively, Fastify's `reply.callNotFound()` is not what we want.
      // Easiest is to factor out the core logic, or just duplicate the handle for now since it's deeply tied to `reply`.
      // Actually, since we're generating this cleanly, let's just create a shared handler function.
      return handleOpenAICompletion(request, reply);
    }
  );

  // Helper functions for the completion logic
  async function handleOpenAICompletion(request: any, reply: any) {
    const project = request.project;
    const body = request.body;

    let routingResponse;
    try {
      routingResponse = await routeRequest(body, project, request.log);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Routing model failed');
      return reply.status(503).send({
        error: { type: 'routing_failed', message: `Routing model failed: ${msg}` },
      });
    }

    const candidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);

    if (body.stream === true) {
      const allModelsList = await readConfig('models');
      const sortedCandidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);

      let headersCommitted = false;

      for (const candidate of sortedCandidates) {
        const model = allModelsList.find((m: any) => m.id === candidate.model);
        if (!model) continue;

        const allowed = await isAllowed(model, project);
        if (!allowed) {
          request.log.info({ modelId: model.id }, 'Model budget exhausted, skipping');
          continue;
        }

        const adapter = getProviderAdapter(model);
        const t0 = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;

        // Obtain the async iterator without committing SSE headers yet.
        // If the provider throws on the first .next() call (auth/network error),
        // we can still fall back to the next candidate transparently.
        const streamIter = adapter.streamCompletion(body, model)[Symbol.asyncIterator]();

        let firstResult: IteratorResult<any>;
        try {
          firstResult = await streamIter.next();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.warn({ err, modelId: model.id }, 'Stream failed before first chunk, trying next candidate');
          await trackUsage({
            projectId: project.id,
            model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - t0,
            outcome: 'error',
            errorMessage: msg,
          });
          continue; // Headers not yet committed — safe to try next
        }

        if (firstResult.done) {
          // Provider returned an empty stream — try next candidate
          continue;
        }

        // First chunk received — now commit SSE headers
        if (!headersCommitted) {
          headersCommitted = true;
          reply.raw.setHeader('Content-Type', 'text/event-stream');
          reply.raw.setHeader('Cache-Control', 'no-cache');
          reply.raw.setHeader('Connection', 'keep-alive');
        }

        const processChunk = (chunk: any) => {
          const chunkAny = chunk as Record<string, unknown>;
          if (chunkAny['usage'] && typeof chunkAny['usage'] === 'object') {
            const usage = chunkAny['usage'] as { prompt_tokens?: number; completion_tokens?: number };
            inputTokens = usage.prompt_tokens ?? inputTokens;
            outputTokens = usage.completion_tokens ?? outputTokens;
          }
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        };

        processChunk(firstResult.value);

        try {
          let result = await streamIter.next();
          while (!result.done) {
            processChunk(result.value);
            result = await streamIter.next();
          }
          reply.raw.write('data: [DONE]\n\n');
          await trackUsage({
            projectId: project.id,
            model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - t0,
            outcome: 'success',
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.error({ err, modelId: model.id }, 'Streaming error mid-stream');
          await trackUsage({
            projectId: project.id,
            model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - t0,
            outcome: 'error',
            errorMessage: msg,
          });
          // Already streaming to client — cannot retry a different model silently
          if (!reply.sent) {
            reply.raw.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
          }
        }

        reply.raw.end();
        return;
      }

      // All candidates exhausted without starting a stream
      if (!headersCommitted) {
        return reply.status(503).send({
          error: { type: 'no_model_available', message: 'All candidate models are unavailable or budget-exhausted.' },
        });
      }

      reply.raw.end();
      return;
    }

    const allModels = await readConfig('models');
    for (const candidate of candidates) {
      const model = allModels.find((m: any) => m.id === candidate.model);
      if (!model) continue;

      const allowed = await isAllowed(model, project);
      if (!allowed) {
        request.log.info({ modelId: model.id }, 'Model budget exhausted, skipping');
        continue;
      }

      const adapter = getProviderAdapter(model);
      const t0 = Date.now();
      try {
        const response = await adapter.chatCompletion(body, model);
        await trackUsage({
          projectId: project.id,
          model,
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          latencyMs: Date.now() - t0,
          outcome: 'success',
        });

        return reply.send(response);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate');
        await trackUsage({
          projectId: project.id,
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - t0,
          outcome: 'error',
          errorMessage: msg,
        });
      }
    }

    return reply.status(503).send({
      error: { type: 'all_models_failed', message: 'All candidate models failed or are budget-exhausted.' },
    });
  }

  // ─── GET /v1/models ───────────────────────────────────────────────────────────
  fastify.get('/v1/models', async (request, reply) => {
    const project = request.project;
    const allModels = await readConfig('models');

    const projectModels = project.models
      .map((ref) => allModels.find((m) => m.id === ref.modelId))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);

    const data: ModelObject[] = projectModels.map((m) => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
    }));

    return reply.send({ object: 'list', data });
  });

  // ─── GET /v1/models/:model ────────────────────────────────────────────────────
  fastify.get<{ Params: { model: string } }>('/v1/models/:model', async (request, reply) => {
    const project = request.project;
    const allModels = await readConfig('models');

    // Ensure the model is available to the project
    const isAvailable = project.models.some((ref) => ref.modelId === request.params.model);
    if (!isAvailable) {
      return reply.status(404).send({
        error: { type: 'not_found', message: `Model '${request.params.model}' not found or not available to this project.` }
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
