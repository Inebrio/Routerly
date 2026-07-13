import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MessagesRequest, Settings, ProjectConfig } from '@routerly/shared';
import { routeRequest } from '../routing/router.js';
import { readConfig } from '../config/loader.js';
import { setTrace, appendTrace } from '../routing/traceStore.js';
import type { TraceEntry } from '../routing/traceStore.js';
import { llmMessages, llmChat, llmStream, checkBudget, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';
import { getProviderAdapter } from '../providers/index.js';
import { forwardAnthropicOAuth, forwardAnthropicApiKey } from './oauthForward.js';
import type { ChatCompletionRequest, MessagesResponse } from '@routerly/shared';
import { checkGuardrails, buildRequestInjection } from '../middleware/guardrails.js';
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

/** Convert a MessagesRequest to an OpenAI-compat ChatCompletionRequest for non-Anthropic providers. */
function toChat(body: MessagesRequest): ChatCompletionRequest {
  const msgs: Array<{ role: string; content: string }> = [];
  if (body.system) {
    msgs.push({ role: 'system', content: typeof body.system === 'string' ? body.system : JSON.stringify(body.system) });
  }
  for (const m of body.messages) {
    msgs.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content :
        Array.isArray(m.content) ? (m.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('') : '',
    });
  }
  return { model: body.model, messages: msgs as ChatCompletionRequest['messages'], max_tokens: body.max_tokens, stream: body.stream ?? false, ...(body.temperature != null ? { temperature: body.temperature } : {}), ...(body.top_p != null ? { top_p: body.top_p } : {}) };
}

/** Convert an OpenAI ChatCompletionResponse to Anthropic MessagesResponse. */
function chatToMessages(chat: import('@routerly/shared').ChatCompletionResponse, id: string, requestedModel: string): MessagesResponse {
  const choice = chat.choices?.[0];
  const msgContent = choice?.message?.content;
  return { id: chat.id || `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: typeof msgContent === 'string' ? msgContent : '' }], model: chat.model || requestedModel, stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : 'max_tokens', stop_sequence: null, usage: { input_tokens: chat.usage?.prompt_tokens ?? 0, output_tokens: chat.usage?.completion_tokens ?? 0 } };
}

/** Convert OpenAI StreamChunks to Anthropic SSE event lines. */
async function* chunksToAnthropicSSE(
  chunks: AsyncIterable<import('@routerly/shared').StreamChunk>,
  msgId: string,
  requestedModel: string,
): AsyncGenerator<string> {
  let started = false;
  for await (const chunk of chunks) {
    if (!started) {
      started = true;
      const chunkAny = chunk as any;
      yield `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], stop_reason: null, stop_sequence: null, model: chunk.model || requestedModel, usage: { input_tokens: chunkAny.usage?.prompt_tokens ?? 0, output_tokens: 0 } } })}\n\n`;
      yield `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`;
      yield `event: ping\ndata: {"type":"ping"}\n\n`;
    }
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`;
    const finish = chunk.choices?.[0]?.finish_reason;
    if (finish) {
      const outTokens = (chunk as any).usage?.completion_tokens ?? 0;
      yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;
      yield `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: finish === 'stop' ? 'end_turn' : 'max_tokens', stop_sequence: null }, usage: { output_tokens: outTokens } })}\n\n`;
      yield `event: message_stop\ndata: {"type":"message_stop"}\n\n`;
    }
  }
}

export const anthropicRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── POST /v1/messages ────────────────────────────────────────────────────────
  fastify.post<{ Body: MessagesRequest }>('/v1/messages', async (request, reply) => {
    const project = request.project;
    const body = request.body;

    const traceId = randomUUID();
    setTrace(traceId, []);
    const conversationId = (request.headers['x-routerly-conversation-id'] as string | undefined) || undefined;
    // Only emit x-routerly-trace-id when the Playground opts in (wire-format transparency).
    const traceOptIn = request.headers['x-routerly-trace'] === '1';

    // Real project context for guardrail judge/embedding calls (#77, BUG-4).
    const guardrailPctx = { projectId: project.id, project, ...(request.token ? { token: request.token } : {}) };

    // ── PII scrubbing — input (#76) ──────────────────────────────────────────
    // Runs BEFORE guardrails so the judge never sees raw PII.
    // Trace order: pii:evaluated/pii:scrubbed -> guardrail:evaluated/guardrail:triggered.
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

    // ── Content guardrails (#77) ─────────────────────────────────────────────
    // Evaluates the SCRUBBED messages so PII is never sent to the judge.
    // Scans the full conversation (conversationText) to detect multi-turn bypass (#7).
    let guardrailTriggered: string | undefined;
    if (project.guardrails) {
      // Anthropic content can be a string or an array of blocks with .text on type:'text' blocks.
      function msgText(content: unknown): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text as string).join('\n');
        return '';
      }
      const scrubbedMsgs = body.messages ?? [];
      const lastUserMsg = [...scrubbedMsgs].reverse().find((m: any) => m?.role === 'user');
      const primaryText = msgText(lastUserMsg?.content);
      const conversationText = scrubbedMsgs.map((m: any) => `${m.role}: ${msgText(m?.content)}`).join('\n');
      let result: Awaited<ReturnType<typeof checkGuardrails>>;
      try {
        result = await checkGuardrails('request', primaryText, project.guardrails, guardrailPctx, request.log, conversationText);
      } catch (err: unknown) {
        // Over-limit guardrail judge call: fail like an over-limit completion (BUG-4).
        if (err instanceof BudgetExceededError) {
          if (traceOptIn) reply.header('x-routerly-trace-id', traceId);
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
          if (traceOptIn) reply.header('x-routerly-trace-id', traceId);
          // Wire-faithful refusal: empty content + stop_reason refusal + stop_details.
          return reply.status(200).send({ id: `msg_${traceId}`, type: 'message', role: 'assistant', content: [], model: body.model ?? 'unknown', stop_reason: 'refusal', stop_details: { type: 'refusal' }, usage: { input_tokens: 0, output_tokens: 0 } });
        }
        // log-only: record trigger and continue
        if (result.log) guardrailTriggered = hit.triggered;
      }

      // Inject guardrail steering into the outgoing system (enforcement inject/both).
      // Reached only when the request passed (block paths return above).
      // ponytail: append after the client's system (guardrail text last); switch to
      // prepend if the guardrail must take precedence over the user's system.
      const injection = buildRequestInjection(project.guardrails);
      if (injection) {
        if (typeof body.system === 'string' && body.system.trim()) body.system = `${body.system}\n\n${injection}`;
        else if (Array.isArray(body.system)) (body.system as Array<{ type: string; text: string }>).push({ type: 'text', text: injection });
        else (body as { system?: string }).system = injection;
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

      // ── OAuth models: verbatim pass-through with OAuth token ─────────────────
      if (model.provider === 'anthropic-oauth') {
        if (traceOptIn) reply.header('x-routerly-trace-id', traceId);
        return forwardAnthropicOAuth(request, reply, model);
      }

      // ── Anthropic API-key models: verbatim pass-through with x-api-key ───────
      // Transparent forwarding preserves all Claude Code fields (context_management,
      // effort, betas, tools, etc.) without SDK intermediation.
      if (model.provider === 'anthropic' || model.provider === 'anthropic-web') {
        if (traceOptIn) reply.header('x-routerly-trace-id', traceId);
        return forwardAnthropicApiKey(request, reply, model);
      }

      // ── Non-Anthropic providers: convert format and route ─────────────────────
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

      if (body.stream) {
        const chatBody = toChat(body);
        let streamResult;
        try {
          streamResult = await llmStream(chatBody, model, ctx);
        } catch (err) {
          if (!(err instanceof BudgetExceededError)) {
            request.log.warn({ err, modelId: model.id }, 'Anthropic messages stream failed, trying next candidate');
          }
          continue;
        }
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        if (traceOptIn) reply.raw.setHeader('x-routerly-trace-id', traceId);
        reply.raw.flushHeaders();
        try {
          for await (const line of chunksToAnthropicSSE(streamResult.chunks, `msg_${traceId}`, body.model)) {
            reply.raw.write(line);
          }
        } catch { /* mid-stream error, nothing to do */ }
        reply.raw.end();
        return reply;
      }

      try {
        const chatBody = toChat(body);
        const chatResp = await llmChat(chatBody, model, ctx);
        const response = chatToMessages(chatResp, traceId, body.model);
        if (traceOptIn) reply.header('x-routerly-trace-id', traceId);
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
