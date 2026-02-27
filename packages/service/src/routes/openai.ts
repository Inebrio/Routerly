import type { FastifyPluginAsync } from 'fastify';
import type { ChatCompletionRequest, ModelObject } from '@localrouter/shared';
import { routeRequest } from '../routing/router.js';
import { selectModel } from '../routing/selector.js';
import { getProviderAdapter } from '../providers/index.js';
import { trackUsage } from '../cost/tracker.js';
import { readConfig } from '../config/loader.js';
import { isAllowed } from '../cost/budget.js';

export const openaiRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/chat/completions ───────────────────────────────────────────────
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request, reply) => {
      const project = request.project;
      const body = request.body;

      // 1. Ask routing model for weighted candidate list
      let routingResponse;
      try {
        routingResponse = await routeRequest(body, project);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, 'Routing model failed');
        return reply.status(503).send({
          error: { type: 'routing_failed', message: `Routing model failed: ${msg}` },
        });
      }

      // Sort candidates by weight descending
      const candidates = [...routingResponse.models].sort((a, b) => b.weight - a.weight);

      // 2. Streaming path
      if (body.stream === true) {
        // Select first eligible model
        const selectedModel = await selectModel(routingResponse, project);
        if (!selectedModel) {
          return reply.status(503).send({
            error: {
              type: 'no_model_available',
              message: 'All candidate models are budget-exhausted. Try again later.',
            },
          });
        }

        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        let inputTokens = 0;
        let outputTokens = 0;
        const t0 = Date.now();

        try {
          const adapter = getProviderAdapter(selectedModel);
          for await (const chunk of adapter.streamCompletion(body, selectedModel)) {
            // Capture usage if present (some providers send it in the last chunk)
            const chunkAny = chunk as Record<string, unknown>;
            if (chunkAny['usage'] && typeof chunkAny['usage'] === 'object') {
              const usage = chunkAny['usage'] as { prompt_tokens?: number; completion_tokens?: number };
              inputTokens = usage.prompt_tokens ?? inputTokens;
              outputTokens = usage.completion_tokens ?? outputTokens;
            }
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          reply.raw.write('data: [DONE]\n\n');

          await trackUsage({
            projectId: project.id,
            model: selectedModel,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - t0,
            outcome: 'success',
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.error({ err, modelId: selectedModel.id }, 'Streaming error');
          await trackUsage({
            projectId: project.id,
            model: selectedModel,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - t0,
            outcome: 'error',
            errorMessage: msg,
          });
          if (!reply.sent) {
            reply.raw.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
          }
        }
        reply.raw.end();
        return;
      }

      // 3. Non-streaming path with per-candidate fallback
      const allModels = await readConfig('models');

      for (const candidate of candidates) {
        const model = allModels.find((m) => m.id === candidate.model);
        if (!model) continue;

        // Check budget for this specific candidate
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
          // Continue to next candidate
        }
      }

      return reply.status(503).send({
        error: {
          type: 'all_models_failed',
          message: 'All candidate models failed or are budget-exhausted.',
        },
      });
    },
  );

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
};
