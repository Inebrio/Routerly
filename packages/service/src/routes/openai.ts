import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionRequest, ModelObject, ProjectConfig } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { addRoutingDecision } from '../routing/routingMemoryStore.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmChat, llmStream, BudgetExceededError } from '../llm/executor.js';
import { forwardOpenAIOAuthSSE } from './openaiOAuthForward.js';
import type { LLMCallContext } from '../llm/executor.js';
import { checkGuardrails } from '../middleware/guardrails.js';
import { scrubMessages, scrubText, StreamingScrubber } from '../middleware/piiScrubber.js';
import { emitEvent } from '../notifications/emitter.js';
import { trackUsage } from '../cost/tracker.js';


/**
 * Records a usage event for a guardrail-blocked request (#77 observability).
 * Zero cost/tokens, outcome 'blocked', callType 'guardrail', attributed to the
 * project's first model (none of the project's models was actually called).
 * Shares the trackUsage path used everywhere else — no new recording channel.
 */
async function trackBlockedRequest(project: ProjectConfig, blockedBy: string, traceId: string): Promise<void> {
  const allModels = await readConfig('models');
  const firstModelId = project.models?.[0]?.modelId;
  const model = firstModelId ? allModels.find((m) => m.id === firstModelId) : undefined;
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

    // Usage enrichment: end-user (#96)
    const endUserId = (body as any).user as string | undefined || undefined;

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
        request.log.warn({ projectId: project.id, rule: hit.triggered, action: result.action }, 'guardrail: triggered');
        // Trace carries the human-readable reason (incl. fallbackMessage) for the dashboard — it no longer ships in the wire response (#76/#77).
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:triggered', details: { rule: hit.triggered, target: 'request', action: result.action, fallbackMessage } }]);
        if (result.action === 'block') {
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
      // "ran" signal: always emitted when input scrubbing is active, even with 0 redactions.
      appendTrace(traceId, [{ panel: 'request', message: 'pii:evaluated', details: { redacted } }]);
      if (redacted.length > 0) {
        body.messages = messages;
        piiRedacted = redacted;
        request.log.info({ projectId: project.id, redacted }, 'pii: scrubbed');
        appendTrace(traceId, [{ panel: 'request', message: 'pii:scrubbed', details: { entities: redacted } }]);
      }
    }

    // Read models list once
    const allModels = await readConfig('models');

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

      const suppressTrace = request.headers['x-routerly-no-trace'] === '1';

      const emit = (entry: TraceEntry) => {
                appendTrace(traceId, [entry]);
        if (!suppressTrace) {
                  reply.raw.write(`data: ${JSON.stringify({ type: 'trace', entry })}\n\n`);
        }
      };

      let sortedCandidates: Array<{ model: string; weight: number }>;
      {
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

        // Emit trace entries from routing response
        for (const entry of routingResponse.trace) {
          emit(entry);
        }
      }

      let streamPrimaryModelId: string | undefined;
      let streamPrimaryFailed = false;
      for (const candidate of sortedCandidates) {
        const model = allModels.find((m: any) => m.id === candidate.model);
        if (!model) continue;

        if (!streamPrimaryModelId) streamPrimaryModelId = model.id;

        const ctx: LLMCallContext = {
          projectId: project.id,
          project,
          token: request.token,
          callType: 'completion',
          traceId,
          emit,
          log: request.log,
          ...(endUserId ? { endUserId } : {}),
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
          if (model.id === streamPrimaryModelId) streamPrimaryFailed = true;
          continue;
        }

        if (streamPrimaryFailed && model.id !== streamPrimaryModelId) {
          void emitEvent('routing.fallback_used', 'info', { projectId: project.id, primaryModelId: streamPrimaryModelId, fallbackModelId: model.id, traceId }, { projectId: project.id, log: request.log });
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
            // "ran" signal: always emitted when output scrubbing is active, even with 0 redactions.
            appendTrace(traceId, [{ panel: 'response', message: 'pii:evaluated', details: { redacted: [...outputScrubber.found] } }]);
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
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: hit.triggered, target: 'response', action: result.action, fallbackMessage } }]);
              if (result.action === 'block') {
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

    let sortedCandidates: Array<{ model: string; weight: number }>;
    {
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

    let chatPrimaryModelId: string | undefined;
    let chatPrimaryFailed = false;
    for (const candidate of sortedCandidates) {
      const model = allModels.find((m: any) => m.id === candidate.model);
      if (!model) continue;

      if (!chatPrimaryModelId) chatPrimaryModelId = model.id;

      const ctx: LLMCallContext = {
        projectId: project.id,
        project,
        token: request.token,
        callType: 'completion',
        traceId,
        emit,
        log: request.log,
        ...(endUserId ? { endUserId } : {}),
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


        if (project.pii?.scrubOutput === true) {
          const content = response.choices?.[0]?.message?.content;
          if (typeof content === 'string') {
            const { text, found } = scrubText(content, project.pii);
            // "ran" signal: always emitted when output scrubbing is active, even with 0 redactions.
            appendTrace(traceId, [{ panel: 'response', message: 'pii:evaluated', details: { redacted: found } }]);
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
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: hit.triggered, target: 'response', action: result.action, fallbackMessage } }]);
              if (result.action === 'block') {
                reply.header('x-routerly-trace-id', traceId);
                // Wire-faithful content_filter block: empty content + content_filter finish_reason.
                return reply.code(200).send({ id: `chatcmpl-${traceId}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
              }
              guardrailTriggered = hit.triggered;
            }
          }
        }

        if (chatPrimaryFailed && model.id !== chatPrimaryModelId) {
          void emitEvent('routing.fallback_used', 'info', { projectId: project.id, primaryModelId: chatPrimaryModelId, fallbackModelId: model.id, traceId }, { projectId: project.id, log: request.log });
        }
        reply.header('x-routerly-trace-id', traceId);
        return reply.send(response);
      } catch (err: unknown) {
        if (!(err instanceof BudgetExceededError)) {
          request.log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate');
        }
        if (model.id === chatPrimaryModelId) chatPrimaryFailed = true;
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
