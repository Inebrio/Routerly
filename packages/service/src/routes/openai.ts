import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionRequest, ModelObject } from '@localrouter/shared';
import { routeRequest } from '../routing/router.js';
import { getProviderAdapter } from '../providers/index.js';
import { trackUsage } from '../cost/tracker.js';
import { readConfig } from '../config/loader.js';
import { isAllowed } from '../cost/budget.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';

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

    // ── Avvia SSE immediatamente, prima che il routing inizi ─────────────────
    const traceId = randomUUID();
    setTrace(traceId, []);

    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('x-localrouter-trace-id', traceId);
    reply.raw.flushHeaders();

    const emit = (entry: TraceEntry) => {
      appendTrace(traceId, [entry]);
      reply.raw.write(`data: ${JSON.stringify({ type: 'trace', entry })}\n\n`);
    };

    let routingResponse;
    try {
      routingResponse = await routeRequest(body, project, request.log, emit);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Routing model failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Routing model failed: ${msg}` })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    // ── Model call ───────────────────────────────────────────────────────────
    const allModelsList = await readConfig('models');
    const sortedCandidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);
    const isStream = body.stream !== false;

    if (isStream) {
      for (const candidate of sortedCandidates) {
        const model = allModelsList.find((m: any) => m.id === candidate.model);
        if (!model) continue;

        const allowed = await isAllowed(model, project);
        if (!allowed) {
          request.log.info({ modelId: model.id }, 'Model budget exhausted, skipping');
          emit({ panel: 'response', message: 'model:skipped', details: { modelId: model.id, reason: 'budget_exhausted' } });
          continue;
        }

        const adapter = getProviderAdapter(model);
        const t0 = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        let thinkingAccum = '';     // accumulates thinking text across delta chunks
        let thinkingEmitted = false;

        emit({ panel: 'request', message: 'model:request', details: { modelId: model.id, provider: model.provider, stream: true, messages: body.messages?.length ?? 0 } });

        // Request usage stats in the final stream chunk (OpenAI-compatible standard)
        const streamBody = { ...body, stream_options: { include_usage: true } };

        const streamIter = adapter.streamCompletion(streamBody, model)[Symbol.asyncIterator]();
        let firstResult: IteratorResult<any>;
        try {
          firstResult = await streamIter.next();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.warn({ err, modelId: model.id }, 'Stream failed before first chunk, trying next candidate');
          emit({ panel: 'response', message: 'model:error', details: { modelId: model.id, error: msg, latencyMs: Date.now() - t0 } });
          await trackUsage({ projectId: project.id, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, outcome: 'error', errorMessage: msg, callType: 'completion', traceId });
          continue;
        }

        if (firstResult.done) continue;

        const ttftMs = Date.now() - t0;

        const processChunk = (chunk: any) => {
          const u = chunk.usage;
          if (u) {
            inputTokens = u.prompt_tokens ?? inputTokens;
            outputTokens = u.completion_tokens ?? outputTokens;
          }
          const delta = chunk?.choices?.[0]?.delta as any;
          if (delta?.thinking !== undefined) {
            // Thinking delta — accumulate for trace, forward for FE animation
            thinkingAccum += delta.thinking as string;
          } else if (delta?.content !== undefined && !thinkingEmitted && thinkingAccum) {
            // First text chunk after thinking — emit accumulated thinking as one trace entry
            emit({ panel: 'response', message: 'model:thinking', details: { modelId: model.id, text: thinkingAccum } });
            thinkingEmitted = true;
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
          // Emit thinking trace if not yet emitted (e.g. model only thought, no text)
          if (thinkingAccum && !thinkingEmitted) {
            emit({ panel: 'response', message: 'model:thinking', details: { modelId: model.id, text: thinkingAccum } });
          }
          reply.raw.write('data: [DONE]\n\n');
          emit({ panel: 'response', message: 'model:success', details: { modelId: model.id, inputTokens, outputTokens, latencyMs: Date.now() - t0 } });
          await trackUsage({ projectId: project.id, model, inputTokens, outputTokens, latencyMs: Date.now() - t0, ttftMs, outcome: 'success', callType: 'completion', traceId });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.error({ err, modelId: model.id }, 'Streaming error mid-stream');
          emit({ panel: 'response', message: 'model:error', details: { modelId: model.id, error: msg, latencyMs: Date.now() - t0 } });
          await trackUsage({ projectId: project.id, model, inputTokens, outputTokens, latencyMs: Date.now() - t0, ttftMs, outcome: 'error', errorMessage: msg, callType: 'completion', traceId });
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        }

        reply.raw.end();
        return;
      }

      // All candidates exhausted
      emit({ panel: 'response', message: 'model:error', details: { error: 'All candidates unavailable or budget-exhausted' } });
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'All candidate models are unavailable or budget-exhausted.' })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    // ── Non-streaming path ───────────────────────────────────────────────────
    for (const candidate of sortedCandidates) {
      const model = allModelsList.find((m: any) => m.id === candidate.model);
      if (!model) continue;

      const allowed = await isAllowed(model, project);
      if (!allowed) {
        emit({ panel: 'response', message: 'model:skipped', details: { modelId: model.id, reason: 'budget_exhausted' } });
        continue;
      }

      const adapter = getProviderAdapter(model);
      const t0 = Date.now();
      emit({ panel: 'request', message: 'model:request', details: { modelId: model.id, provider: model.provider, stream: false, messages: body.messages?.length ?? 0 } });

      try {
        const response = await adapter.chatCompletion(body, model);
        emit({ panel: 'response', message: 'model:success', details: { modelId: model.id, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, latencyMs: Date.now() - t0 } });
        await trackUsage({ projectId: project.id, model, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, latencyMs: Date.now() - t0, outcome: 'success', callType: 'completion', traceId });
        // Emit as a fake SSE chunk so the FE can read it uniformly
        const fakeChunk = {
          id: response.id,
          object: 'chat.completion.chunk',
          created: response.created,
          model: response.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: response.choices[0]?.message.content ?? '' }, finish_reason: 'stop' }],
          usage: response.usage,
        };
        reply.raw.write(`data: ${JSON.stringify(fakeChunk)}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate');
        emit({ panel: 'response', message: 'model:error', details: { modelId: model.id, error: msg, latencyMs: Date.now() - t0 } });
        await trackUsage({ projectId: project.id, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, outcome: 'error', errorMessage: msg, callType: 'completion', traceId });
      }
    }

    reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'All candidate models failed or are budget-exhausted.' })}\n\n`);
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
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
