import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionRequest, ModelObject, SemanticCacheConfig } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { addRoutingDecision } from '../routing/routingMemoryStore.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmChat, llmStream, BudgetExceededError } from '../llm/executor.js';
import { forwardOpenAIOAuthSSE } from './openaiOAuthForward.js';
import type { LLMCallContext } from '../llm/executor.js';
import { getEmbeddingProvider } from '../embeddings/index.js';
import type { EmbeddingProviderType } from '../embeddings/index.js';
import { lookupCache, storeCache } from '../cache/semanticResponseCache.js';

function resolveEmbeddingUpstreamModelId(modelId: string, explicitUpstreamModelId?: string): string {
  if (explicitUpstreamModelId) return explicitUpstreamModelId;
  return modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
}

function getCacheEmbeddingText(messages: unknown[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => {
    if (!message || typeof message !== 'object') return false;
    return (message as { role?: string }).role === 'user';
  }) as { content?: unknown } | undefined;

  const latestContent = latestUserMessage?.content;
  if (typeof latestContent === 'string' && latestContent.trim().length > 0) {
    return latestContent;
  }

  if (Array.isArray(latestContent)) {
    const parts = latestContent
      .map((part) => {
        if (!part || typeof part !== 'object') return null;
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : null;
      })
      .filter((part): part is string => Boolean(part && part.trim().length > 0));
    if (parts.length > 0) return parts.join('\n');
  }

  return messages.map(
    (message) => {
      if (!message || typeof message !== 'object') return '';
      const typedMessage = message as { role?: string; content?: unknown };
      const content = typeof typedMessage.content === 'string'
        ? typedMessage.content
        : JSON.stringify(typedMessage.content);
      return `${typedMessage.role ?? 'unknown'}: ${content}`;
    },
  ).join('\n');
}

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
      delete body.input;
      if (body.max_tokens !== undefined) {
        body.max_output_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      if (body.max_completion_tokens !== undefined) {
        body.max_output_tokens = body.max_completion_tokens;
        delete body.max_completion_tokens;
      }
      // Responses API always streams
      body.stream = true;

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
    const isStream = body.stream === true;
    const startMs = Date.now();

    const msgs = body.messages ?? [];
    const payloadChars = JSON.stringify(msgs).length;
    request.log.info(
      {
        messageCount: msgs.length,
        roles: msgs.map((m: any) => m?.role),
        payloadChars,
        stream: isStream,
      },
      'completion: request',
    );

    const traceId = randomUUID();
    setTrace(traceId, []);
    const conversationId = (request.headers['x-routerly-conversation-id'] as string | undefined) || undefined;
    const isMemoryEnabled = (project.policies ?? []).some(
      (p: any) => p.type === 'llm' && p.enabled && p.config?.memory === true,
    );

    // Read models list once — used by cache embedding lookup and routing candidates
    const allModels = await readConfig('models');

    // ── Semantic response cache ────────────────────────────────────────────
    const cachePolicy = (project.policies ?? []).find(
      (p: any) => p.type === 'llm' && p.enabled && p.config?.cache?.enabled,
    ) as { config: { cache: SemanticCacheConfig } } | undefined;

    let cacheVector: number[] | null = null;
    let cachedModelId: string | null = null;
    let cacheSimilarityScore: number | null = null;

    if (cachePolicy) {
      const cacheConfig = cachePolicy.config.cache;
      const threshold = cacheConfig.similarity_threshold ?? 0.85;
      const ttlMs = (cacheConfig.ttl_seconds ?? 3600) * 1_000;

      const messagesText = getCacheEmbeddingText(body.messages ?? []);

      try {
        const modelIds = [
          cacheConfig.embedding_model,
          ...(cacheConfig.embedding_fallback_models ?? []),
        ].filter(Boolean) as string[];

        for (const [index, modelId] of modelIds.entries()) {
          try {
            // Derive provider details from the model definition (has endpoint + apiKey already configured).
            // Fall back to values in cacheConfig for backward compatibility.
            const modelDef = allModels.find(m => m.id === modelId);
            const providerType: EmbeddingProviderType =
              modelDef?.provider === 'ollama' ? 'ollama' : (cacheConfig.embedding_provider ?? 'openai');
            const endpoint = modelDef?.endpoint ?? cacheConfig.embedding_endpoint;
            const apiKey = modelDef?.apiKey ?? cacheConfig.embedding_api_key;
            const upstreamModelId = resolveEmbeddingUpstreamModelId(modelId, modelDef?.upstreamModelId);
            appendTrace(traceId, [{
              panel: 'response',
              message: 'cache:embedding',
              details: {
                modelId,
                upstreamModelId,
                provider: providerType,
                endpoint,
                source: modelDef ? 'model-config' : 'cache-config',
                fallback: index > 0,
                attempt: index + 1,
                totalCandidates: modelIds.length,
              },
            }]);
            const provider = getEmbeddingProvider(providerType, endpoint, apiKey);
            const { embeddings } = await provider.embed([messagesText], upstreamModelId);
            cacheVector = embeddings[0] ?? null;
            break;
          } catch {
            // try next fallback
          }
        }

        if (cacheVector) {
          const extendMs = cacheConfig.extend_on_hit ? ttlMs : undefined;
          const hit = lookupCache(project.id, cacheVector, threshold, extendMs);
          if (hit) {
            request.log.info({ projectId: project.id, similarity: hit.similarity }, 'semantic-cache: hit');
            appendTrace(traceId, [{
              panel: 'response',
              message: 'cache:hit',
              details: {
                similarity: hit.similarity,
                modelId: hit.modelId,
                embeddingModel: cacheConfig.embedding_model,
                ttlExtended: !!cacheConfig.extend_on_hit,
              },
            }]);
            cachedModelId = hit.modelId;
            cacheSimilarityScore = hit.similarity;
          } else {
            appendTrace(traceId, [{
              panel: 'response',
              message: 'cache:miss',
              details: { embeddingModel: cacheConfig.embedding_model },
            }]);
          }
        }
      } catch (err) {
        request.log.warn({ err }, 'semantic-cache: embedding failed, proceeding without cache');
        cacheVector = null;
      }
    }

    if (isStream) {
      // ── Streaming path: avvia SSE subito ──────────────────────────────────
      reply.hijack();
      const origin = request.headers.origin;
      if (origin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader('Access-Control-Expose-Headers', 'x-routerly-trace-id');
      }
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('x-routerly-trace-id', traceId);
      reply.raw.flushHeaders();

      const emit = (entry: TraceEntry) => {
        appendTrace(traceId, [entry]);
        reply.raw.write(`data: ${JSON.stringify({ type: 'trace', entry })}\n\n`);
      };

      let sortedCandidates: Array<{ model: string; weight: number }>;
      if (cachedModelId) {
        // Cache hit: skip routing, use the cached model directly
        sortedCandidates = [{ model: cachedModelId, weight: 1 }];
      } else {
        let routingResponse;
        try {
          routingResponse = await routeRequest(body, project, request.log, emit, request.token, traceId, conversationId);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.error({ err }, 'Routing model failed');
          const errChunk = { id: `chatcmpl-${traceId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? '', choices: [{ index: 0, delta: { content: `Routing failed: ${msg}` }, finish_reason: 'stop' }] };
          reply.raw.write(`data: ${JSON.stringify(errChunk)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return;
        }

        if (isMemoryEnabled && conversationId && routingResponse.models.length > 0) {
          addRoutingDecision(project.id, conversationId, routingResponse.models[0]!.model);
        }

        sortedCandidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);
      }

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
          ...(cachedModelId !== null
            ? { cacheHit: true as const, ...(cacheSimilarityScore !== null ? { cacheSimilarity: cacheSimilarityScore } : {}) }
            : {}),
        };

        if (model.provider === 'openai-oauth') {
          await forwardOpenAIOAuthSSE(reply.raw, body as Record<string, unknown>, model, request.log, traceId, project.id);
          reply.raw.end();
          return;
        }

        let streamResult: Awaited<ReturnType<typeof llmStream>>;
        try {
          streamResult = await llmStream(body, model, ctx);
        } catch (err: unknown) {
          if (!(err instanceof BudgetExceededError)) {
            request.log.warn({ err, modelId: model.id }, 'Stream failed before first chunk, trying next candidate');
          }
          continue;
        }

        try {
          let fullContent = '';
          for await (const chunk of streamResult.chunks) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) fullContent += delta;
          }
          reply.raw.write('data: [DONE]\n\n');
          request.log.info({ modelId: model.id, contentChars: fullContent.length }, 'completion: response');

          // Store routing decision in semantic cache on cache miss
          if (cachePolicy && cacheVector && !cachedModelId) {
            const ttlMs = (cachePolicy.config.cache.ttl_seconds ?? 3600) * 1_000;
            storeCache(project.id, cacheVector, model.id, ttlMs);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.error({ err, modelId: model.id }, 'Streaming error mid-stream');
          reply.raw.write('data: [DONE]\n\n');
        }

        reply.raw.end();
        return;
      }

      // Tutti i candidati esauriti
      emit({ panel: 'response', message: 'model:error', details: { error: 'All candidates unavailable or budget-exhausted' } });
      const errChunk = { id: `chatcmpl-${traceId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? '', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      reply.raw.write(`data: ${JSON.stringify(errChunk)}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    // ── Non-streaming path: risposta JSON standard ───────────────────────────
    const emit = (entry: TraceEntry) => {
      appendTrace(traceId, [entry]);
    };

    let sortedCandidates: Array<{ model: string; weight: number }>;
    if (cachedModelId) {
      // Cache hit: skip routing, use the cached model directly
      sortedCandidates = [{ model: cachedModelId, weight: 1 }];
    } else {
      let routingResponse;
      try {
        routingResponse = await routeRequest(body, project, request.log, emit, request.token, traceId, conversationId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, 'Routing model failed');
        return reply.code(500).send({ error: { message: `Routing model failed: ${msg}`, type: 'server_error' } });
      }

      if (isMemoryEnabled && conversationId && routingResponse.models.length > 0) {
        addRoutingDecision(project.id, conversationId, routingResponse.models[0]!.model);
      }

      sortedCandidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);
    }

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
        ...(cachedModelId !== null
          ? { cacheHit: true as const, ...(cacheSimilarityScore !== null ? { cacheSimilarity: cacheSimilarityScore } : {}) }
          : {}),
      };

      if (model.provider === 'openai-oauth') {
        return reply.code(422).send({
          error: {
            message: 'openai-oauth requires streaming. Use /v1/responses with stream: true.',
            type: 'invalid_request_error',
          },
        });
      }

      try {
        const response = await llmChat(body, model, ctx);
        request.log.info(
          {
            modelId: model.id,
            inputTokens: response.usage?.prompt_tokens,
            outputTokens: response.usage?.completion_tokens,
            finishReason: response.choices?.[0]?.finish_reason,
          },
          'completion: response',
        );

        // Store routing decision in semantic cache on cache miss
        if (cachePolicy && cacheVector && !cachedModelId) {
          const ttlMs = (cachePolicy.config.cache.ttl_seconds ?? 3600) * 1_000;
          storeCache(project.id, cacheVector, model.id, ttlMs);
        }

        reply.header('x-routerly-trace-id', traceId);
        return reply.send(response);
      } catch (err: unknown) {
        if (!(err instanceof BudgetExceededError)) {
          request.log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate');
        }
      }
    }

    return reply.code(503).send({ error: { message: 'All candidate models failed or are budget-exhausted.', type: 'server_error' } });
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
