import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MessagesRequest, Settings, ProjectConfig } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmMessages, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';
import { forwardAnthropicOAuth } from './oauthForward.js';
import { checkGuardrails } from '../middleware/guardrails.js';
import { mergePolicies, scrubMessages, scrubText } from '../middleware/piiScrubber.js';
import { trackUsage } from '../cost/tracker.js';

/**
 * Records a usage event for a guardrail-blocked request (#77 observability).
 * Zero cost/tokens, outcome 'blocked', callType 'guardrail', attributed to the
 * project's first model. Shares the trackUsage path — no new recording channel.
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

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const project = request.project;
    const body = request.body;

    const traceId = randomUUID();
    setTrace(traceId, []);
    const conversationId = (request.headers['x-routerly-conversation-id'] as string | undefined) || undefined;

    // Real project context for guardrail judge/embedding calls (#77, BUG-4).
    const guardrailPctx = { projectId: project.id, project, ...(request.token ? { token: request.token } : {}) };
    // ── Content guardrails (#77) ─────────────────────────────────────────────
    let guardrailTriggered: string | undefined;
    if (project.guardrails) {
      const msgs = body.messages ?? [];
      const lastUserMsg = [...msgs].reverse().find((m: any) => m?.role === 'user');
      const inputText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      let result: Awaited<ReturnType<typeof checkGuardrails>>;
      try {
        result = await checkGuardrails('request', inputText, project.guardrails, guardrailPctx, request.log);
      } catch (err: unknown) {
        // Over-limit guardrail judge call: fail like an over-limit completion (BUG-4).
        if (err instanceof BudgetExceededError) {
          reply.header('x-routerly-trace-id', traceId);
          return reply.status(429).send({ type: 'error', error: { type: 'rate_limit_error', message: 'Usage limit exceeded by content-guardrail check.' } });
        }
        throw err;
      }
      // Observability (#77): record that guardrails were evaluated and the per-rule result, not only triggers.
      if (result.evaluated.length > 0) {
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:evaluated', details: { target: 'request', rules: result.evaluated } }]);
      }
      const hit = result.triggered ? { triggered: result.triggered } : null;
      if (hit) {
        const blockMessage = result.blockMessage ?? 'This request was blocked by content guardrails.';
        request.log.warn({ projectId: project.id, rule: hit.triggered, block: result.block, log: result.log }, 'guardrail: triggered');
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:triggered', details: { rule: hit.triggered, target: 'request', block: result.block, log: result.log, blockMessage } }]);
        if (result.block) {
          // Usage record for the blocked request (#77): zero cost/tokens, distinct 'blocked' outcome.
          await trackBlockedRequest(project, hit.triggered, traceId);
          reply.header('x-routerly-trace-id', traceId);
          // Wire-faithful refusal: empty content + stop_reason refusal + stop_details.
          return reply.status(200).send({ id: `msg_${traceId}`, type: 'message', role: 'assistant', content: [], model: body.model ?? 'unknown', stop_reason: 'refusal', stop_details: { type: 'refusal' }, usage: { input_tokens: 0, output_tokens: 0 } });
        }
        // log-only: record trigger and continue
        if (result.log) guardrailTriggered = hit.triggered;
      }
    }

    // ── PII scrubbing (#76) ──────────────────────────────────────────────────
    let piiRedacted: string[] | undefined;
    const inPii = project.pii?.policies?.length ? mergePolicies(project.pii.policies, 'input') : null;
    if (inPii && (inPii.entities?.length || inPii.customPatterns?.length) && Array.isArray(body.messages)) {
      const { messages, redacted } = scrubMessages(body.messages, inPii);
      // "ran" signal: always emitted when input scrubbing is active, even with 0 redactions.
      appendTrace(traceId, [{ panel: 'request', message: 'pii:evaluated', details: { redacted } }]);
      if (redacted.length > 0) {
        body.messages = messages as typeof body.messages;
        piiRedacted = redacted;
        request.log.info({ projectId: project.id, redacted }, 'pii: scrubbed');
        appendTrace(traceId, [{ panel: 'request', message: 'pii:scrubbed', details: { entities: redacted } }]);
      }
    }

    // Convert Anthropic messages to OpenAI format for routing policies
    const openAICompatBody = {
      model: body.model,
      messages: body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      max_tokens: body.max_tokens,
    };

    const emit = (entry: TraceEntry) => {
      appendTrace(traceId, [entry]);
    };

    // Usage enrichment headers (#94, #95, #96)
    const endUserId = (body as any).user as string | undefined || undefined;

    const allModels = await readConfig('models');

    // 1. Resolve candidates via routing.
    let sortedCandidates: Array<{ model: string; weight: number }>;
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
    sortedCandidates = [...routingResponse.models].sort((a: any, b: any) => b.weight - a.weight);

    for (const candidate of sortedCandidates) {
      const model = allModels.find((m: any) => m.id === candidate.model);
      if (!model) continue;

      // Subscription / OAuth models forward verbatim (no SDK, no routing
      // transforms, no fallback) so the client's system block is preserved.
      if (model.provider === 'anthropic-oauth') {
        reply.header('x-routerly-trace-id', traceId);
        return forwardAnthropicOAuth(request, reply, model);
      }

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
        ...(conversationId ? { sessionId: conversationId } : {}),
        ...(request.token?.tags ? { tags: request.token.tags } : {}),
      };

      try {
        const response = await llmMessages(body, model, ctx);
        const outPii = project.pii?.policies?.length ? mergePolicies(project.pii.policies, 'output') : null;
        if (outPii && (outPii.entities?.length || outPii.customPatterns?.length)) {
          const block = response?.content?.[0];
          if (block?.type === 'text' && typeof block.text === 'string') {
            const { text, found } = scrubText(block.text, outPii);
            // "ran" signal: always emitted when output scrubbing is active, even with 0 redactions.
            appendTrace(traceId, [{ panel: 'response', message: 'pii:evaluated', details: { redacted: found } }]);
            if (found.length > 0) {
              block.text = text;
              request.log.info({ projectId: project.id, found }, 'pii: scrubbed output');
              // PII output trace (#76).
              appendTrace(traceId, [{ panel: 'response', message: 'pii:scrubbed', details: { entities: found } }]);
            }
          }
        }

        // ── Response guardrail (#77) ───────────────────────────────────────────
        if (project.guardrails) {
          const block = response?.content?.[0];
          const responseText = block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
          if (responseText) {
            const result = await checkGuardrails('response', responseText, project.guardrails, guardrailPctx, request.log);
            if (result.evaluated.length > 0) {
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:evaluated', details: { target: 'response', rules: result.evaluated } }]);
            }
            const hit = result.triggered ? { triggered: result.triggered } : null;
            if (hit) {
              const blockMessage = result.blockMessage ?? 'Response blocked by content guardrails.';
              request.log.warn({ projectId: project.id, rule: hit.triggered, block: result.block, log: result.log }, 'guardrail: response triggered');
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: hit.triggered, target: 'response', block: result.block, log: result.log, blockMessage } }]);
              if (result.block) {
                // Usage record for the blocked response (#77): zero cost/tokens, distinct 'blocked' outcome.
                await trackBlockedRequest(project, hit.triggered, traceId);
                reply.header('x-routerly-trace-id', traceId);
                // Wire-faithful refusal: empty content + stop_reason refusal + stop_details.
                return reply.status(200).send({ id: `msg_${traceId}`, type: 'message', role: 'assistant', content: [], model: body.model ?? 'unknown', stop_reason: 'refusal', stop_details: { type: 'refusal' }, usage: { input_tokens: 0, output_tokens: 0 } });
              }
              // log-only: record trigger and continue
              if (result.log) guardrailTriggered = hit.triggered;
            }
          }
        }

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
