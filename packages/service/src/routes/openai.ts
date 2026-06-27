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
import { parseRoutingTags } from './requestEnrichment.js';
import { AGENT_POLICY_HEADER, resolveAgentPolicy, agentPolicyCandidates } from '../routing/agentPolicy.js';
import { checkGuardrails } from '../middleware/guardrails.js';
import { scrubMessages, scrubText, StreamingScrubber } from '../middleware/piiScrubber.js';
import { emitEvent } from '../notifications/emitter.js';
import { lookupResponseCache, storeResponseCache } from '../cache/llmResponseCache.js';
import { textToVector } from '../cache/textVector.js';
import { trackUsage } from '../cost/tracker.js';

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

/**
 * Records a usage event for a guardrail-blocked request (#77 observability).
 * Zero cost/tokens, outcome 'blocked', callType 'guardrail', attributed to the
 * project's first model (none of the project's models was actually called).
 * Shares the trackUsage path used everywhere else — no new recording channel.
 */
async function trackBlockedRequest(project: any, blockedBy: string, traceId: string): Promise<void> {
  const allModels = await readConfig('models');
  const firstModelId = project.models?.[0]?.modelId;
  const model = firstModelId ? allModels.find((m: any) => m.id === firstModelId) : undefined;
  if (!model) return; // ponytail: no project model to attribute to → nothing to record
  await trackUsage({
    projectId: project.id,
    model,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    outcome: 'blocked',
    callType: 'guardrail',
    traceId,
    guardrailTriggered: blockedBy,
    blockedBy,
  }).catch(() => {});
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

    // Usage enrichment: end-user (#96), session (#94), tags (#95)
    const endUserId = (body as any).user as string | undefined || undefined;
    const sessionId = (request.headers['x-routerly-session-id'] as string | undefined) || undefined;
    const tags = parseRoutingTags(request.headers['x-routerly-tags'] as string | undefined);

    // ── Content guardrails (#77) ─────────────────────────────────────────────
    // Checks input messages against the project's guardrail rules.
    // On 'block' we short-circuit with the fallback message; 'flag'/'log' record
    // the rule on the usage record and continue.
    // Real project context for guardrail judge/embedding calls (#77, BUG-4):
    // their tokens are attributed and gated against the caller's project.
    const guardrailPctx = { projectId: project.id, project, ...(request.token ? { token: request.token } : {}) };
    let guardrailTriggered: string | undefined;
    if (project.guardrails) {
      const msgs = body.messages ?? [];
      const lastUserMsg = [...msgs].reverse().find((m: any) => m?.role === 'user');
      const inputText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      let result: Awaited<ReturnType<typeof checkGuardrails>>;
      try {
        result = await checkGuardrails('request', inputText, project.guardrails, guardrailPctx, request.log);
      } catch (err: unknown) {
        // Over-limit guardrail judge call: fail the request like an over-limit completion (BUG-4).
        if (err instanceof BudgetExceededError) {
          reply.header('x-routerly-trace-id', traceId);
          return reply.code(429).send({ error: { message: 'Usage limit exceeded by content-guardrail check.', type: 'insufficient_quota' } });
        }
        throw err;
      }
      // Observability (#77): record that guardrails were evaluated and the per-rule result, not only triggers.
      if (result.evaluated.length > 0) {
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:evaluated', details: { target: 'request', rules: result.evaluated } }]);
      }
      const hit = result.triggered ? { triggered: result.triggered } : null;
      if (hit) {
        const fallbackMessage = project.guardrails.fallbackMessage ?? 'This request was blocked by content guardrails.';
        request.log.warn({ projectId: project.id, rule: hit.triggered, action: project.guardrails.action }, 'guardrail: triggered');
        // Trace carries the human-readable reason (incl. fallbackMessage) for the dashboard — it no longer ships in the wire response (#76/#77).
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:triggered', details: { rule: hit.triggered, target: 'request', action: project.guardrails.action, fallbackMessage } }]);
        if (project.guardrails.action === 'block') {
          // Usage record for the blocked request (#77): zero cost/tokens, distinct 'blocked' outcome.
          await trackBlockedRequest(project, hit.triggered, traceId);
          if (isStream) {
            reply.hijack();
            const _origin = request.headers.origin;
            if (_origin) {
              reply.raw.setHeader('Access-Control-Allow-Origin', _origin);
              reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
              reply.raw.setHeader('Access-Control-Expose-Headers', 'x-routerly-trace-id');
            }
            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');
            reply.raw.setHeader('x-routerly-trace-id', traceId);
            reply.raw.flushHeaders();
            // Wire-faithful content_filter block: empty delta + content_filter finish_reason, then [DONE].
            const chunk = JSON.stringify({ id: `chatcmpl-${traceId}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] });
            reply.raw.write(`data: ${chunk}\n\n`);
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
            return;
          }
          reply.header('x-routerly-trace-id', traceId);
          // Wire-faithful content_filter block: empty content + content_filter finish_reason.
          return reply.code(200).send({ id: `chatcmpl-${traceId}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
        }
        guardrailTriggered = hit.triggered;
      }
    }

    // ── PII scrubbing (#76) ──────────────────────────────────────────────────
    // Redact PII entities from message content before forwarding to the provider.
    let piiRedacted: string[] | undefined;
    if (project.pii && project.pii.scrubInput !== false && Array.isArray(body.messages)) {
      const { messages, redacted } = scrubMessages(body.messages, project.pii);
      if (redacted.length > 0) {
        body.messages = messages;
        piiRedacted = redacted;
        request.log.info({ projectId: project.id, redacted }, 'pii: scrubbed');
        appendTrace(traceId, [{ panel: 'request', message: 'pii:scrubbed', details: { entities: redacted } }]);
      }
    }

    // Read models list once — used by cache embedding lookup and routing candidates
    const allModels = await readConfig('models');

    // Per-agent routing policy override (#78): X-Routerly-Policy selects a named
    // policy in the project config that overrides the routing decision.
    const agentPolicyName = (request.headers[AGENT_POLICY_HEADER] as string | undefined) || undefined;
    const agentPolicy = resolveAgentPolicy(project, agentPolicyName);
    if (agentPolicyName && !agentPolicy) {
      request.log.warn({ projectId: project.id, agentPolicyName }, 'agent-policy: unknown policy, falling back to routing');
    }
    const agentPolicyOverride = agentPolicy ? agentPolicyCandidates(agentPolicy, allModels) : null;

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
      if (agentPolicyOverride) {
        // Agent policy override (#78): use the policy's ordered models, bypass routing.
        emit({ panel: 'router-response', message: 'agent-policy:override', details: { policy: agentPolicy!.name, models: agentPolicyOverride.map((c) => c.model) } });
        sortedCandidates = [...agentPolicyOverride];
      } else if (cachedModelId) {
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
          ...(endUserId ? { endUserId } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(tags ? { tags } : {}),
          ...(agentPolicy ? { agentPolicyName: agentPolicy.name } : {}),
          ...(agentPolicy?.maxCostUsd !== undefined ? { agentPolicyCostCapUsd: agentPolicy.maxCostUsd } : {}),
        };

        if (model.provider === 'openai-oauth') {
          await forwardOpenAIOAuthSSE(reply.raw, body as Record<string, unknown>, model, request.log, traceId, project.id, project.pii);
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
          const outputScrubber = project.pii?.scrubOutput === true
            ? new StreamingScrubber(project.pii)
            : null;

          // ponytail: buffer SSE only when response guardrail needs to intercept before flushing
          const hasResponseGuardrails = project.guardrails &&
            project.guardrails.rules.some((r: any) => r.target === 'response' || r.target === 'both');
          const bufferForGuardrail = hasResponseGuardrails && project.guardrails!.action === 'block';
          const sseBuffer: string[] = [];

          function writeSSE(data: string): void {
            if (bufferForGuardrail) { sseBuffer.push(data); } else { reply.raw.write(data); }
          }

          for await (const chunk of streamResult.chunks) {
            let outChunk = chunk;
            if (outputScrubber) {
              const delta = chunk.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) {
                const scrubbed = outputScrubber.push(delta);
                const c0 = chunk.choices![0]!;
                outChunk = { ...chunk, choices: [{ index: c0.index, finish_reason: c0.finish_reason, delta: { ...c0.delta, content: scrubbed } }] };
              }
            }
            writeSSE(`data: ${JSON.stringify(outChunk)}\n\n`);
            const d = outChunk.choices?.[0]?.delta?.content;
            if (d) fullContent += d;
          }

          if (outputScrubber) {
            const remaining = outputScrubber.flush();
            if (remaining) {
              const flushChunk = {
                id: `chatcmpl-${traceId}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? '',
                choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
              };
              writeSSE(`data: ${JSON.stringify(flushChunk)}\n\n`);
              fullContent += remaining;
            }
            // PII output trace (#76): record entities redacted across the stream.
            if (outputScrubber.found.size > 0) {
              appendTrace(traceId, [{ panel: 'response', message: 'pii:scrubbed', details: { entities: [...outputScrubber.found] } }]);
            }
          }

          // ── Streaming response guardrail (#77) ─────────────────────────────
          if (hasResponseGuardrails && fullContent) {
            const result = await checkGuardrails('response', fullContent, project.guardrails!, guardrailPctx, request.log);
            if (result.evaluated.length > 0) {
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:evaluated', details: { target: 'response', rules: result.evaluated } }]);
            }
            const hit = result.triggered ? { triggered: result.triggered } : null;
            if (hit) {
              const fallbackMessage = project.guardrails!.fallbackMessage ?? 'Response blocked by content guardrails.';
              request.log.warn({ projectId: project.id, rule: hit.triggered }, 'guardrail: stream response triggered');
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: hit.triggered, target: 'response', action: project.guardrails!.action, fallbackMessage } }]);
              if (project.guardrails!.action === 'block') {
                // Wire-faithful content_filter block: empty delta + content_filter finish_reason (buffered output dropped).
                const fallbackChunk = { id: `chatcmpl-${traceId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? '', choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] };
                reply.raw.write(`data: ${JSON.stringify(fallbackChunk)}\n\n`);
              } else {
                for (const d of sseBuffer) reply.raw.write(d);
              }
            } else {
              for (const d of sseBuffer) reply.raw.write(d);
            }
          } else {
            // flush buffer (empty when not buffering, pass-through otherwise)
            for (const d of sseBuffer) reply.raw.write(d);
          }

          reply.raw.write('data: [DONE]\n\n');
          request.log.info({ modelId: model.id, contentChars: fullContent.length }, 'completion: response');

          // Store routing decision in semantic cache on cache miss
          if (cachePolicy && cacheVector && !cachedModelId) {
            const ttlMs = (cachePolicy.config.cache.ttl_seconds ?? 3600) * 1_000;
            storeCache(project.id, cacheVector, model.id, ttlMs);
          }
        } catch (err: unknown) {
          request.log.error({ err, modelId: model.id }, 'Streaming error mid-stream');
          reply.raw.write('data: [DONE]\n\n');
        }

        reply.raw.end();
        return;
      }

      // Tutti i candidati esauriti
      emit({ panel: 'response', message: 'model:error', details: { error: 'All candidates unavailable or budget-exhausted' } });
      void emitEvent('routing.no_candidates', 'critical', { projectId: project.id, requestedModel: body.model ?? null, traceId }, { projectId: project.id, log: request.log });
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

    // ── Semantic response cache (non-streaming, TF bag-of-words) ────────────
    if (project.semanticCache?.enabled && !isStream) {
      const lastUserMsg = (body.messages ?? []).findLast((m: any) => m.role === 'user');
      const text = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      if (text) {
        const vec = textToVector(text);
        if (vec.length > 0) {
          const threshold = project.semanticCache.threshold ?? 0.95;
          const hit = lookupResponseCache(project.id, vec, threshold);
          if (hit) {
            request.log.info({ projectId: project.id, similarity: hit.similarity }, 'llm-response-cache: hit');
            // Find first valid model for tracking (use project's first model)
            const firstModelId = project.models[0]?.modelId;
            const trackModel = firstModelId ? allModels.find((m: any) => m.id === firstModelId) : undefined;
            if (trackModel) {
              await trackUsage({
                projectId: project.id,
                model: trackModel,
                inputTokens: hit.promptTokens,
                outputTokens: hit.completionTokens,
                latencyMs: 0,
                outcome: 'success',
                callType: 'completion',
                traceId,
                cacheHit: true,
                cacheSimilarity: hit.similarity,
              });
            }
            reply.header('x-routerly-trace-id', traceId);
            reply.header('X-Routerly-Cache', 'HIT');
            return reply.send(JSON.parse(hit.response));
          }
          // Store vec for post-call storage — attach to request context
          (request as any)._responseCacheVec = vec;
        }
      }
    }

    let sortedCandidates: Array<{ model: string; weight: number }>;
    if (agentPolicyOverride) {
      // Agent policy override (#78): use the policy's ordered models, bypass routing.
      emit({ panel: 'router-response', message: 'agent-policy:override', details: { policy: agentPolicy!.name, models: agentPolicyOverride.map((c) => c.model) } });
      sortedCandidates = [...agentPolicyOverride];
    } else if (cachedModelId) {
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
        ...(endUserId ? { endUserId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(tags ? { tags } : {}),
        ...(agentPolicy ? { agentPolicyName: agentPolicy.name } : {}),
        ...(agentPolicy?.maxCostUsd !== undefined ? { agentPolicyCostCapUsd: agentPolicy.maxCostUsd } : {}),
        ...(guardrailTriggered ? { guardrailTriggered } : {}),
        ...(piiRedacted ? { piiRedacted } : {}),
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

        // Store full response in semantic response cache (non-streaming)
        const responseCacheVec = (request as any)._responseCacheVec as number[] | undefined;
        if (project.semanticCache?.enabled && responseCacheVec && !isStream) {
          storeResponseCache(
            project.id,
            responseCacheVec,
            JSON.stringify(response),
            response.usage?.prompt_tokens ?? 0,
            response.usage?.completion_tokens ?? 0,
            project.semanticCache.ttlMs ?? 3_600_000,
            project.semanticCache.maxEntries ?? 500,
          );
        }

        if (project.pii?.scrubOutput === true) {
          const content = response.choices?.[0]?.message?.content;
          if (typeof content === 'string') {
            const { text, found } = scrubText(content, project.pii);
            if (found.length > 0) {
              response.choices![0]!.message.content = text;
              request.log.info({ projectId: project.id, found }, 'pii: scrubbed output');
              // PII output trace (#76).
              appendTrace(traceId, [{ panel: 'response', message: 'pii:scrubbed', details: { entities: found } }]);
            }
          }
        }

        // ── Response guardrail (#77) ───────────────────────────────────────────
        if (project.guardrails) {
          const responseContent = response.choices?.[0]?.message?.content;
          if (typeof responseContent === 'string' && responseContent.length > 0) {
            const result = await checkGuardrails('response', responseContent, project.guardrails, guardrailPctx, request.log);
            if (result.evaluated.length > 0) {
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:evaluated', details: { target: 'response', rules: result.evaluated } }]);
            }
            const hit = result.triggered ? { triggered: result.triggered } : null;
            if (hit) {
              const fallbackMessage = project.guardrails.fallbackMessage ?? 'Response blocked by content guardrails.';
              request.log.warn({ projectId: project.id, rule: hit.triggered }, 'guardrail: response triggered');
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: hit.triggered, target: 'response', action: project.guardrails.action, fallbackMessage } }]);
              if (project.guardrails.action === 'block') {
                reply.header('x-routerly-trace-id', traceId);
                // Wire-faithful content_filter block: empty content + content_filter finish_reason.
                return reply.code(200).send({ id: `chatcmpl-${traceId}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
              }
              guardrailTriggered = hit.triggered;
            }
          }
        }

        reply.header('x-routerly-trace-id', traceId);
        return reply.send(response);
      } catch (err: unknown) {
        if (!(err instanceof BudgetExceededError)) {
          request.log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate');
        }
      }
    }

    void emitEvent('routing.no_candidates', 'critical', { projectId: project.id, requestedModel: body.model ?? null, traceId }, { projectId: project.id, log: request.log });
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
