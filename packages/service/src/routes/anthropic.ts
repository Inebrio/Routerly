import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MessagesRequest } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmMessages, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const project = request.project;
    const body = request.body;

    // Convert Anthropic messages to OpenAI format for routing policies
    const openAICompatBody = {
      model: body.model,
      messages: body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      max_tokens: body.max_tokens,
    };

    const traceId = randomUUID();
    setTrace(traceId, []);

    const emit = (entry: TraceEntry) => {
      appendTrace(traceId, [entry]);
    };

    // 1. Route request
    let routingResponse;
    try {
      routingResponse = await routeRequest(openAICompatBody, project, request.log, emit);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Routing model failed');
      return reply.status(503).send({
        type: 'error',
        error: { type: 'overloaded_error', message: `Routing failed: ${msg}` },
      });
    }

    // 2. Loop through candidates (highest weight first) with fallback
    const allModels = await readConfig('models');
    const sortedCandidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);

    for (const candidate of sortedCandidates) {
      const model = allModels.find((m: any) => m.id === candidate.model);
      if (!model) continue;

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
        const response = await llmMessages(body, model, ctx);
        reply.header('x-routerly-trace-id', traceId);
        return reply.send(response);
      } catch (err: unknown) {
        if (!(err instanceof BudgetExceededError)) {
          request.log.warn({ err, modelId: model.id }, 'Anthropic messages call failed, trying next candidate');
        }
        continue;
      }
    }

    return reply.status(503).send({
      type: 'error',
      error: { type: 'overloaded_error', message: 'All candidate models are budget-exhausted or unavailable.' },
    });
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
