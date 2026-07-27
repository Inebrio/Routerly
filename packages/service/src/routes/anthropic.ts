import type { FastifyPluginAsync } from 'fastify';
import type { MessagesRequest } from '@routerly/shared';
import { buildAnthropicContext, runProxy, getProxyPipeline } from '../reverse-proxy/index.js';

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const ctx = buildAnthropicContext(request, reply);
    await runProxy(getProxyPipeline(), ctx);
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
