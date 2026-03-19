import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MessagesRequest, ModelConfig } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { selectModel } from '../routing/selector.js';
import { getProviderAdapter } from '../providers/index.js';
import { trackUsage } from '../cost/tracker.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';

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

    // ── Avvia SSE immediatamente, prima che il routing inizi ─────────────────
    const traceId = randomUUID();
    setTrace(traceId, []);

    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('x-routerly-trace-id', traceId);
    reply.raw.flushHeaders();

    const emit = (entry: TraceEntry) => {
      appendTrace(traceId, [entry]);
      reply.raw.write(`data: ${JSON.stringify({ type: 'trace', entry })}\n\n`);
    };

    // 1. Route request
    let routingResponse;
    try {
      routingResponse = await routeRequest(openAICompatBody, project, request.log, emit);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Routing model failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Routing failed: ${msg}` })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    // 2. Routing completato — risposta immediata senza chiamare il modello finale
    const candidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);
    reply.raw.write(`data: ${JSON.stringify({ type: 'result', candidates })}\n\n`);
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    return; // routing-only mode: fine handler

    // eslint-disable-next-line no-unreachable
    const selectedModel = await selectModel(routingResponse, project) as ModelConfig;
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
      const response = await adapter.messages!(body, selectedModel);
      await trackUsage({
        projectId: project.id,
        model: selectedModel,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - t0,
        outcome: 'success',
        callType: 'completion',
      });
      return reply.send(response);
    } catch (err) {
      const msg = err instanceof Error ? (err as Error).message : String(err);
      request.log.error({ err, modelId: selectedModel.id }, 'Anthropic messages call failed');
      await trackUsage({
        projectId: project.id,
        model: selectedModel,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - t0,
        outcome: 'error',
        errorMessage: msg,
        callType: 'completion',
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
