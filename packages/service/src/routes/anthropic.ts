import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MessagesRequest } from '@routerly/shared';
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
import { scrubMessages } from '../middleware/piiScrubber.js';

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const project = request.project;
    const body = request.body;

    const traceId = randomUUID();
    setTrace(traceId, []);

    // ── Content guardrails (#77) ─────────────────────────────────────────────
    let guardrailTriggered: string | undefined;
    if (project.guardrails?.enabled) {
      const hit = checkGuardrails(body.messages ?? [], project.guardrails);
      if (hit) {
        request.log.warn({ projectId: project.id, rule: hit.triggered, action: project.guardrails.action }, 'guardrail: triggered');
        appendTrace(traceId, [{ panel: 'request', message: 'guardrail:triggered', details: { rule: hit.triggered, action: project.guardrails.action } }]);
        if (project.guardrails.action === 'block') {
          const fallback = project.guardrails.fallbackMessage ?? 'This request was blocked by content guardrails.';
          reply.header('x-routerly-trace-id', traceId);
          return reply.status(400).send({ type: 'error', error: { type: 'invalid_request_error', message: fallback } });
        }
        guardrailTriggered = hit.triggered;
      }
    }

    // ── PII scrubbing (#76) ──────────────────────────────────────────────────
    let piiRedacted: string[] | undefined;
    if (project.pii?.enabled && Array.isArray(body.messages)) {
      const { messages, redacted } = scrubMessages(body.messages, project.pii);
      if (redacted.length > 0) {
        body.messages = messages as typeof body.messages;
        piiRedacted = redacted;
        request.log.info({ projectId: project.id, redacted }, 'pii: scrubbed');
        appendTrace(traceId, [{ panel: 'request', message: 'pii:scrubbed', details: { entities: redacted } }]);
      }
    }

    // ── Prompt injection ──────────────────────────────────────────────────
    const promptId = request.headers['x-routerly-prompt-id'] as string | undefined;
    if (promptId) {
      const promptVarsRaw = request.headers['x-routerly-prompt-vars'] as string | undefined;
      const settings = await readConfig('settings') as Settings;
      const prompt = settings.prompts?.find(p => p.id === promptId);
      if (prompt) {
        const activeVer = prompt.versions.find(v => v.version === prompt.activeVersion);
        if (activeVer) {
          let systemPrompt = activeVer.systemPrompt;
          if (promptVarsRaw) {
            try {
              const vars = JSON.parse(promptVarsRaw) as Record<string, string>;
              systemPrompt = systemPrompt.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
            } catch { /* ignore malformed vars */ }
          }
          // Anthropic uses body.system for the system prompt
          body.system = systemPrompt;
          // Prepend seed messages to the messages array
          if (activeVer.seedMessages?.length) {
            body.messages = [...activeVer.seedMessages as MessagesRequest['messages'], ...body.messages];
          }
        }
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
