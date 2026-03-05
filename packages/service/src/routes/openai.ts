import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionRequest, ModelObject } from '@localrouter/shared';
import { routeRequest } from '../routing/router.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmChat, llmStream, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';

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
      routingResponse = await routeRequest(body, project, request.log, emit, request.token, traceId);
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

        // Inietta il prompt di sistema per-progetto se presente, mantenendo
        // eventuali system message già presenti in coda.
        const effectiveBody = candidate.prompt
          ? { ...body, messages: [{ role: 'system', content: candidate.prompt }, ...(body.messages ?? [])] }
          : body;

        if (candidate.prompt) {
          emit({ panel: 'request', message: 'model:prompt', details: { modelId: model.id, prompt: candidate.prompt } });
        }

        const ctx: LLMCallContext = {
          projectId: project.id,
          project,
          token: request.token,
          callType: 'completion',
          traceId,
          emit,
          log: request.log,
        };

        // llmStream gestisce internamente budget, tracking, TTFT e trace.
        // Lancia BudgetExceededError o un errore pre-stream → passa al candidato successivo.
        let streamResult: Awaited<ReturnType<typeof llmStream>>;
        try {
          streamResult = await llmStream(effectiveBody, model, ctx);
        } catch (err: unknown) {
          if (!(err instanceof BudgetExceededError)) {
            request.log.warn({ err, modelId: model.id }, 'Stream failed before first chunk, trying next candidate');
          }
          continue;
        }

        // Il generator emette tutti i chunk; tracking completato nel suo finally.
        try {
          for await (const chunk of streamResult.chunks) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          reply.raw.write('data: [DONE]\n\n');
        } catch (err: unknown) {
          // Errore mid-stream: già tracciato dall'executor; chiudiamo la connessione.
          const msg = err instanceof Error ? err.message : String(err);
          request.log.error({ err, modelId: model.id }, 'Streaming error mid-stream');
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
        }

        reply.raw.end();
        return;
      }

      // Tutti i candidati esauriti
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

      const effectiveBody = candidate.prompt
        ? { ...body, messages: [{ role: 'system', content: candidate.prompt }, ...(body.messages ?? [])] }
        : body;

      if (candidate.prompt) {
        emit({ panel: 'request', message: 'model:prompt', details: { modelId: model.id, prompt: candidate.prompt } });
      }

      const ctx: LLMCallContext = {
        projectId: project.id,
        project,
        token: request.token,
        callType: 'completion',
        traceId,
        emit,
        log: request.log,
      };

      try {
        const response = await llmChat(effectiveBody, model, ctx);
        // Invia come fake SSE chunk per uniformità con il path streaming
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
        // BudgetExceededError o errore del provider: già tracciato dall'executor.
        if (!(err instanceof BudgetExceededError)) {
          request.log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate');
        }
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
