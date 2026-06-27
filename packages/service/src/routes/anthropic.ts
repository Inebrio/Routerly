import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MessagesRequest, Settings } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmMessages, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';
import { forwardAnthropicOAuth } from './oauthForward.js';
import { parseRoutingTags } from './requestEnrichment.js';
import { AGENT_POLICY_HEADER, resolveAgentPolicy, agentPolicyCandidates } from '../routing/agentPolicy.js';
import { checkGuardrails } from '../middleware/guardrails.js';
import { scrubMessages, scrubText } from '../middleware/piiScrubber.js';
import { trackUsage } from '../cost/tracker.js';

/**
 * Records a usage event for a guardrail-blocked request (#77 observability).
 * Zero cost/tokens, outcome 'blocked', callType 'guardrail', attributed to the
 * project's first model. Shares the trackUsage path — no new recording channel.
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

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const project = request.project;
    const body = request.body;

    const traceId = randomUUID();
    setTrace(traceId, []);

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
        const fallbackMessage = project.guardrails.fallbackMessage ?? 'This request was blocked by content guardrails.';
        request.log.warn({ projectId: project.id, rule: hit.triggered, action: project.guardrails.action }, 'guardrail: triggered');
        // Trace carries the readable reason (incl. fallbackMessage); the wire response no longer ships it (#76/#77).
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:triggered', details: { rule: hit.triggered, target: 'request', action: project.guardrails.action, fallbackMessage } }]);
        if (project.guardrails.action === 'block') {
          // Usage record for the blocked request (#77): zero cost/tokens, distinct 'blocked' outcome.
          await trackBlockedRequest(project, hit.triggered, traceId);
          reply.header('x-routerly-trace-id', traceId);
          // Wire-faithful refusal: empty content + stop_reason refusal + stop_details.
          return reply.status(200).send({ id: `msg_${traceId}`, type: 'message', role: 'assistant', content: [], model: body.model ?? 'unknown', stop_reason: 'refusal', stop_details: { type: 'refusal' }, usage: { input_tokens: 0, output_tokens: 0 } });
        }
        guardrailTriggered = hit.triggered;
      }
    }

    // ── PII scrubbing (#76) ──────────────────────────────────────────────────
    let piiRedacted: string[] | undefined;
    if (project.pii && project.pii.scrubInput !== false && Array.isArray(body.messages)) {
      const { messages, redacted } = scrubMessages(body.messages, project.pii);
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
    const sessionId = (request.headers['x-routerly-session-id'] as string | undefined) || undefined;
    const rawTags = request.headers['x-routerly-tags'] as string | undefined;
    const tags = rawTags ? parseRoutingTags(rawTags) : undefined;

    const allModels = await readConfig('models');

    // Per-agent routing policy override (#78): X-Routerly-Policy selects a named
    // policy in the project config that overrides the routing decision.
    const agentPolicyName = (request.headers[AGENT_POLICY_HEADER] as string | undefined) || undefined;
    const agentPolicy = resolveAgentPolicy(project, agentPolicyName);
    if (agentPolicyName && !agentPolicy) {
      request.log.warn({ projectId: project.id, agentPolicyName }, 'agent-policy: unknown policy, falling back to routing');
    }

    // 1. Resolve candidates — agent policy override bypasses routing.
    let sortedCandidates: Array<{ model: string; weight: number }>;
    if (agentPolicy) {
      const override = agentPolicyCandidates(agentPolicy, allModels);
      emit({ panel: 'router-response', message: 'agent-policy:override', details: { policy: agentPolicy.name, models: override.map((c) => c.model) } });
      sortedCandidates = override;
    } else {
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
    }

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
        ...(sessionId ? { sessionId } : {}),
        ...(tags ? { tags } : {}),
        ...(agentPolicy ? { agentPolicyName: agentPolicy.name } : {}),
        ...(agentPolicy?.maxCostUsd !== undefined ? { agentPolicyCostCapUsd: agentPolicy.maxCostUsd } : {}),
        ...(guardrailTriggered ? { guardrailTriggered } : {}),
        ...(piiRedacted ? { piiRedacted } : {}),
      };

      try {
        const response = await llmMessages(body, model, ctx);
        if (project.pii?.scrubOutput === true) {
          const block = response?.content?.[0];
          if (block?.type === 'text' && typeof block.text === 'string') {
            const { text, found } = scrubText(block.text, project.pii);
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
              const fallbackMessage = project.guardrails.fallbackMessage ?? 'Response blocked by content guardrails.';
              request.log.warn({ projectId: project.id, rule: hit.triggered }, 'guardrail: response triggered');
              appendTrace(traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: hit.triggered, target: 'response', action: project.guardrails.action, fallbackMessage } }]);
              if (project.guardrails.action === 'block') {
                reply.header('x-routerly-trace-id', traceId);
                // Wire-faithful refusal: empty content + stop_reason refusal + stop_details.
                return reply.status(200).send({ id: `msg_${traceId}`, type: 'message', role: 'assistant', content: [], model: body.model ?? 'unknown', stop_reason: 'refusal', stop_details: { type: 'refusal' }, usage: { input_tokens: 0, output_tokens: 0 } });
              }
              guardrailTriggered = hit.triggered;
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
